# backend/tools/backfill_yahoo.py
import os
from datetime import datetime, timezone, timedelta

import pandas as pd
import yfinance as yf
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

# Load DATABASE_URL from backend/.env
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL not set in backend/.env")

engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)

# ---- helpers --------------------------------------------------------------

def ensure_prices_table():
    # create table if missing (matches your existing schema)
    with engine.begin() as conn:
        conn.execute(text("""
        CREATE TABLE IF NOT EXISTS prices (
          ts TIMESTAMPTZ NOT NULL,
          symbol TEXT NOT NULL,
          price DOUBLE PRECISION NOT NULL
        );
        """))

def latest_ts(symbol: str) -> datetime | None:
    with engine.begin() as conn:
        row = conn.execute(
            text("SELECT max(ts) FROM prices WHERE symbol=:s"),
            {"s": symbol},
        ).first()
        return row[0] if row and row[0] else None

def insert_ticks(rows: list[dict]):
    if not rows:
        return
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO prices (ts, symbol, price) VALUES (:ts,:symbol,:price)"),
            rows,
        )

# Insert 4 synthetic ticks per candle so OHLC aggregation has body + wicks
def synth_ticks_for_candle(day_ts_utc: datetime, symbol: str, o: float, h: float, l: float, c: float):
    # Put all four ticks inside the same UTC day bucket
    # NOTE: your /ohlc uses time_bucket; for "D" it buckets by UTC day.
    base = day_ts_utc.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)
    return [
        {"ts": base + timedelta(minutes=0), symbol: symbol, "price": float(o)},  # open
        {"ts": base + timedelta(minutes=1), symbol: symbol, "price": float(l)},  # low
        {"ts": base + timedelta(minutes=2), symbol: symbol, "price": float(h)},  # high
        {"ts": base + timedelta(minutes=3), symbol: symbol, "price": float(c)},  # close
    ]

def backfill_daily(symbol: str, years: int = 5):
    print(f"[daily] fetching {symbol} last {years}y…")
    ticker = yf.Ticker(symbol)
    df = ticker.history(period=f"{years}y", interval="1d", auto_adjust=False)
    if df.empty:
        print(f"[daily] no data for {symbol}")
        return

    # df index is DatetimeIndex (tz-aware or naive). Force UTC date.
    df = df.tz_localize(None)
    rows: list[dict] = []

    for dt, row in df.iterrows():
        day_utc = datetime(dt.year, dt.month, dt.day, tzinfo=timezone.utc)
        o = float(row["Open"]); h = float(row["High"]); l = float(row["Low"]); c = float(row["Close"])
        rows.extend(synth_ticks_for_candle(day_utc, symbol, o, h, l, c))

    print(f"[daily] inserting {len(rows)} synthetic ticks for {symbol}…")
    insert_ticks(rows)

def backfill_intraday(symbol: str, days: int = 7):
    # Yahoo only allows ~7 days for 1m interval without paid data
    print(f"[1m] fetching {symbol} last {days}d (yfinance limit ~7d)…")
    ticker = yf.Ticker(symbol)
    df = ticker.history(period=f"{days}d", interval="1m", auto_adjust=False)
    if df.empty:
        print(f"[1m] no intraday for {symbol}")
        return

    df = df.tz_convert("UTC") if df.index.tz is not None else df.tz_localize("UTC")

    rows: list[dict] = []
    for ts, row in df.iterrows():
        # Create the 4 ticks inside this minute for better candles
        minute_start = ts.to_pydatetime().replace(second=0, microsecond=0, tzinfo=timezone.utc)
        o = float(row["Open"]); h = float(row["High"]); l = float(row["Low"]); c = float(row["Close"])
        rows.extend([
            {"ts": minute_start + timedelta(seconds=0),  symbol: symbol, "price": o},
            {"ts": minute_start + timedelta(seconds=15), symbol: symbol, "price": l},
            {"ts": minute_start + timedelta(seconds=30), symbol: symbol, "price": h},
            {"ts": minute_start + timedelta(seconds=45), symbol: symbol, "price": c},
        ])

    print(f"[1m] inserting {len(rows)} synthetic ticks for {symbol}…")
    insert_ticks(rows)

def main():
    ensure_prices_table()

    # Backfill both symbols
    for sym in ("SPY", "QQQ"):
        print(f"=== {sym} ===")
        # Daily (broad history)
        backfill_daily(sym, years=5)
        # Intraday last few days (optional; comment out if you only want daily)
        backfill_intraday(sym, days=7)

    # Show a quick summary
    with engine.begin() as conn:
        for sym in ("SPY", "QQQ"):
            cnt = conn.execute(text("SELECT count(*) FROM prices WHERE symbol=:s"), {"s": sym}).scalar()
            mx  = conn.execute(text("SELECT max(ts) FROM prices WHERE symbol=:s"), {"s": sym}).scalar()
            print(f"{sym}: rows={cnt}, max_ts={mx}")

if __name__ == "__main__":
    main()