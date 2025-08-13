# backend/main.py

from datetime import datetime, timezone
from typing import List, Optional, Set

import asyncio
import json
import os

from fastapi import FastAPI, Depends, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session
import websockets  
from dotenv import load_dotenv
import ssl, certifi
import httpx
import time, math, random
from typing import Optional  
from fastapi import HTTPException


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(BASE_DIR, ".env")
load_dotenv(ENV_PATH)

from database import engine, Base, get_db, SessionLocal

FINNHUB_TOKEN = os.getenv("FINNHUB_TOKEN")
print("FINNHUB_TOKEN loaded?", bool(FINNHUB_TOKEN))

FINN_SYMBOLS = ["QQQ", "SPY"]

# from models import Widget  # (unused right now)

# ----- Create app FIRST (only once)
app = FastAPI()

# ----- CORS (after app creation)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ===================== Database setup =====================
def ts_utc_from_finnhub(ts_val):
    if not ts_val:
        return datetime.now(timezone.utc)
    # if it's huge, it's milliseconds
    sec = ts_val / 1000.0 if ts_val > 1e12 else float(ts_val)
    return datetime.fromtimestamp(sec, tz=timezone.utc)

# ===================== WebSocket manager =====================
class WSManager:
    def __init__(self):
        self.active: Set[WebSocket] = set()
    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.add(ws)
    def disconnect(self, ws: WebSocket):
        self.active.discard(ws)
    async def broadcast(self, message: str):
        dead = []
        for ws in list(self.active):
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

ws_manager = WSManager()


@app.websocket("/ws/prices")
async def ws_prices(ws: WebSocket):
    await ws_manager.connect(ws)
    try:
        while True:
            # keepalive; clients may send any ping text
            await ws.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)
        
# ===================== Finnhub REST API polling task =====================
        
FINNHUB_TOKEN = os.getenv("FINNHUB_TOKEN")

# REST symbols to request from Finnhub → map to how you want them stored
REST_SYMBOLS = {
    "QQQ": "QQQ",          # ETF proxy for NASDAQ-100
    "SPY": "SPY",          # ETF proxy for S&P 500
}

async def finnhub_poll_task():
    if not FINNHUB_TOKEN:
        print("⚠️ FINNHUB_TOKEN not set; skipping poll task.")
        return

    async with httpx.AsyncClient(timeout=10) as client:
        while True:
            try:
                out = []
                for api_symbol, store_symbol in REST_SYMBOLS.items():
                    r = await client.get(
                        "https://finnhub.io/api/v1/quote",
                        params={"symbol": api_symbol, "token": FINNHUB_TOKEN},
                    )
                    if r.status_code != 200:
                        print("quote error", api_symbol, r.status_code, r.text)
                        continue

                    q = r.json()  # { c: current, t: unix seconds, ... }
                    price = q.get("c")
                    ts_sec = q.get("t") or 0
                    if price is None:
                        continue

                    from datetime import datetime, timezone
                    ts = datetime.fromtimestamp(ts_sec, tz=timezone.utc) if ts_sec else datetime.now(timezone.utc)

                    # Write to DB
                    with SessionLocal() as db:
                        db.execute(
                            text("INSERT INTO prices (ts, symbol, price) VALUES (:ts, :symbol, :price)"),
                            {"ts": ts, "symbol": store_symbol, "price": float(price)},
                        )
                        db.commit()

                    out.append({"ts": ts.isoformat(), "symbol": store_symbol, "price": float(price)})

                # Push to all connected frontend clients
                if out:
                    await ws_manager.broadcast(json.dumps({"type": "prices", "data": out}))

            except Exception as e:
                print("poll error:", e)

            await asyncio.sleep(5)  # poll every 5 seconds
        
# ===================== Finnhub WebSocket stream =====================

FFINNHUB_TOKEN = os.getenv("FINNHUB_TOKEN")
FINN_SYMBOLS = ["QQQ", "SPY", "BINANCE:BTCUSDT", "BINANCE:ETHUSDT"]

async def finnhub_stream_task():
    print("🔎 starting finnhub_stream_task...")
    if not FINNHUB_TOKEN:
        print("⚠️ FINNHUB_TOKEN not set; skipping realtime task.")
        return

    # SSL context so macOS certs are valid
    SSL_CTX = ssl.create_default_context()
    SSL_CTX.load_verify_locations(certifi.where())

    url = f"wss://ws.finnhub.io?token={FINNHUB_TOKEN}"

    while True:
        try:
            async with websockets.connect(url, ping_interval=20, ssl=SSL_CTX) as ws:
                # subscribe to all desired symbols
                for sym in FINN_SYMBOLS:
                    await ws.send(json.dumps({"type": "subscribe", "symbol": sym}))
                print("✅ Subscribed to:", FINN_SYMBOLS)

                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except Exception:
                        continue

                    # skip pings / non-trade messages
                    if msg.get("type") == "ping":
                        continue
                    if msg.get("type") != "trade" or "data" not in msg:
                        continue

                    rows = []
                    # each trade tick is in msg["data"]
                    for d in msg["data"]:
                        sym   = d.get("s")
                        price = d.get("p")
                        ts_raw = d.get("t")  # <-- define the timestamp variable here
                        if sym is None or price is None:
                            continue
                        ts = ts_utc_from_finnhub(ts_raw)

                        # insert into DB
                        with SessionLocal() as db:
                            db.execute(
                                text("INSERT INTO prices (ts, symbol, price) VALUES (:ts,:symbol,:price)"),
                                {"ts": ts, "symbol": sym, "price": float(price)},
                            )
                            db.commit()

                        rows.append({"ts": ts.isoformat(), "symbol": sym, "price": float(price)})

                    if rows:
                        await ws_manager.broadcast(json.dumps({"type": "prices", "data": rows}))

        except Exception as e:
            print("Finnhub stream error, reconnecting in 3s:", e)
            await asyncio.sleep(3)

# ===================== Realtime task (Polygon placeholder) =====================
POLYGON_API_KEY = os.getenv("POLYGON_API_KEY")
SYMBOLS = ["QQQ", "SPY"]  # adjust as you like

async def polygon_stream_task():
    """
    Implemented later. For now, if you haven't filled this in,
    we just log and return so startup doesn't crash.
    """
    print("⚠️ polygon_stream_task not implemented yet.")
    return

# ===================== Backfill endpoint =====================

@app.post("/backfill")
def backfill(
    symbol: str,
    res: str = "D",          # "1","5","15","60","D"
    days: int = 120,         # how far back
):
    if not FINNHUB_TOKEN:
        return {"ok": False, "error": "FINNHUB_TOKEN not set"}

    now = int(time.time())
    start = now - days * 24 * 60 * 60

    params = {
        "symbol": symbol,
        "resolution": res,
        "from": start,
        "to": now,
        "token": FINNHUB_TOKEN,
    }

    with httpx.Client(timeout=20) as client:
        r = client.get("https://finnhub.io/api/v1/stock/candle", params=params)
        if r.status_code != 200:
            return {"ok": False, "status": r.status_code, "text": r.text}
        data = r.json()

    if data.get("s") != "ok":
        return {"ok": False, "status": data.get("s"), "data": data}

    # Finnhub returns parallel arrays: t (sec), o, h, l, c
    ts = data.get("t") or []
    o = data.get("o") or []
    h = data.get("h") or []
    l = data.get("l") or []
    c = data.get("c") or []

    # We’ll store the close price into `prices` (so /ohlc can aggregate O/H/L/C buckets).
    inserted = 0
    with SessionLocal() as db:
        for i in range(len(ts)):
            # Insert each bar's close as a point at bar time
            db.execute(
                text("INSERT INTO prices (ts, symbol, price) VALUES (to_timestamp(:t), :sym, :p)"),
                {"t": int(ts[i]), "sym": symbol, "p": float(c[i])},
            )
            inserted += 1
        db.commit()

    return {"ok": True, "inserted": inserted, "symbol": symbol, "res": res, "days": days}



# ===================== Yahoo Finance backfill endpoint =====================
def _yahoo_interval(res: str) -> str:
    if res == "D" or res.lower() == "d":
        return "1d"
    return f"{res}m"  # "1","5","15","60" -> "1m","5m","15m","60m"

def _chunk_days_for_interval(interval: str) -> int:
    """
    Choose safe chunk sizes to avoid 429s and server-side caps.
    """
    if interval.endswith("m"):
        # Intraday: keep chunks small (Yahoo limits 1m ~7 days total per request).
        return 5  # days per chunk
    # Daily/weekly/monthly: can go bigger but still be polite.
    return 180  # 6 months per chunk

def _backoff_sleep(attempt: int):
    # exponential backoff with jitter: 1s, 2s, 4s, 8s... + jitter
    base = min(8, 2 ** max(0, attempt))
    time.sleep(base + random.uniform(0.0, 0.5))

@app.post("/backfill_yahoo")
def backfill_yahoo(symbol: str, res: str = "D", days: int = 120, include_prepost: bool = False):
    """
    Pulls historical candles from Yahoo Finance and inserts CLOSE prices into `prices`.
    - res: "1","5","15","60","D"
    - days: how many days back in total (will be chunked).
    """
    interval = _yahoo_interval(res)
    now = int(time.time())
    start = now - days * 24 * 60 * 60
    chunk_days = _chunk_days_for_interval(interval)

    headers = {
        # Some edges throttle overly-generic clients; a UA helps
        "User-Agent": "Mozilla/5.0 (compatible; backfill-script/1.0)",
        "Accept": "application/json, text/plain, */*",
    }

    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    inserted_total = 0
    t2 = now

    with httpx.Client(timeout=20, headers=headers) as client, SessionLocal() as db:
        while t2 > start:
            t1 = max(start, t2 - chunk_days * 24 * 60 * 60)

            params = {
                "period1": t1,
                "period2": t2,
                "interval": interval,
                "includePrePost": "true" if include_prepost else "false",
                "events": "history",
                "lang": "en-US",
                "region": "US",
            }

            # retry on 429 / transient errors
            for attempt in range(5):
                r = client.get(url, params=params)
                if r.status_code == 200:
                    break
                if r.status_code in (429, 502, 503, 504):
                    _backoff_sleep(attempt)
                    continue
                return {"ok": False, "status": r.status_code, "text": r.text, "chunk": [t1, t2]}

            if r.status_code != 200:
                return {"ok": False, "status": r.status_code, "text": r.text, "chunk": [t1, t2]}

            data = r.json()
            try:
                result = data["chart"]["result"][0]
                ts_list = result.get("timestamp") or []
                ind = (result.get("indicators") or {}).get("quote") or [{}]
                close_list = ind[0].get("close") or []
            except Exception as e:
                # If this chunk has no data, just move to the next
                ts_list, close_list = [], []

            # Insert CLOSEs as points at bar time
            if ts_list and close_list:
                for t, c in zip(ts_list, close_list):
                    if c is None:
                        continue
                    db.execute(
                        text("INSERT INTO prices (ts, symbol, price) VALUES (to_timestamp(:t), :sym, :p)"),
                        {"t": int(t), "sym": symbol, "p": float(c)},
                    )
                    inserted_total += 1
                db.commit()

            # Move the window backward; small pause between chunks
            t2 = t1
            time.sleep(0.25)  # be polite

    return {
        "ok": True,
        "inserted": inserted_total,
        "symbol": symbol,
        "res": res,
        "interval": interval,
        "days_requested": days,
        "chunk_days": chunk_days,
    }
    
    
    
# ===================== Startup =====================
@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    loop = asyncio.get_event_loop()
    loop.create_task(finnhub_poll_task())  

# ===================== HTTP routes =====================
@app.get("/")
def root():
    return {"message": "FastAPI is working!"}

@app.get("/health/db")
def db_health(db: Session = Depends(get_db)):
    version = db.execute(text("SELECT version();")).scalar()
    has_timescale = db.execute(
        text("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='timescaledb');")
    ).scalar()
    return {"db_version": version, "timescaledb_enabled": bool(has_timescale)}

# ------------------- Prices API -------------------
class PriceIn(BaseModel):
    symbol: str = Field(min_length=1)
    price: float
    ts: Optional[datetime] = None  # default to now() if not provided

class PriceOut(BaseModel):
    ts: datetime
    symbol: str
    price: float

@app.post("/prices", response_model=PriceOut)
def create_price(payload: PriceIn, db: Session = Depends(get_db)):
    if payload.ts is None:
        stmt = text("""
            INSERT INTO prices (ts, symbol, price)
            VALUES (now(), :symbol, :price)
            RETURNING ts, symbol, price;
        """)
        row = db.execute(stmt, {"symbol": payload.symbol, "price": payload.price}).first()
    else:
        stmt = text("""
            INSERT INTO prices (ts, symbol, price)
            VALUES (:ts, :symbol, :price)
            RETURNING ts, symbol, price;
        """)
        row = db.execute(stmt, {"ts": payload.ts, "symbol": payload.symbol, "price": payload.price}).first()
    db.commit()
    return {"ts": row.ts, "symbol": row.symbol, "price": float(row.price)}

@app.post("/prices/bulk", response_model=List[PriceOut])
def create_prices_bulk(payloads: List[PriceIn], db: Session = Depends(get_db)):
    results = []
    for p in payloads:
        if p.ts is None:
            stmt = text("""
                INSERT INTO prices (ts, symbol, price)
                VALUES (now(), :symbol, :price)
                RETURNING ts, symbol, price;
            """)
            row = db.execute(stmt, {"symbol": p.symbol, "price": p.price}).first()
        else:
            stmt = text("""
                INSERT INTO prices (ts, symbol, price)
                VALUES (:ts, :symbol, :price)
                RETURNING ts, symbol, price;
            """)
            row = db.execute(stmt, {"ts": p.ts, "symbol": p.symbol, "price": p.price}).first()
        results.append({"ts": row.ts, "symbol": row.symbol, "price": float(row.price)})
    db.commit()
    return results

@app.get("/prices", response_model=List[PriceOut])
def list_prices(
    db: Session = Depends(get_db),
    symbol: Optional[str] = Query(None),
    start: Optional[datetime] = Query(None, description="ISO 8601, e.g. 2025-08-10T00:00:00Z"),
    end: Optional[datetime] = Query(None, description="ISO 8601, e.g. 2025-08-11T00:00:00Z"),
    limit: int = Query(100, ge=1, le=10000),
):
    clauses = []
    params = {}
    if symbol:
        clauses.append("symbol = :symbol")
        params["symbol"] = symbol
    if start:
        clauses.append("ts >= :start")
        params["start"] = start
    if end:
        clauses.append("ts <= :end")
        params["end"] = end

    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    stmt = text(f"""
        SELECT ts, symbol, price
        FROM prices
        {where}
        ORDER BY ts DESC
        LIMIT :limit;
    """)
    params["limit"] = limit

    rows = db.execute(stmt, params).all()
    return [{"ts": r.ts, "symbol": r.symbol, "price": float(r.price)} for r in rows]

print("FINNHUB_TOKEN loaded?", bool(os.getenv("FINNHUB_TOKEN")))




@app.get("/ohlc")
def get_ohlc(
    symbol: str,
    resolution: str = Query("1", description="Minutes per bar like 1,5,15,60 or 'D' for daily"),
    lookback_minutes: int = Query(390, ge=1, description="How many minutes to include"),
    db: Session = Depends(get_db),
):
    # Normalize resolution to minutes (daily => 1440)
    res_str = str(resolution).strip().upper()
    if res_str == "D":
        res_min = 1440
    else:
        try:
            res_min = int(res_str)
        except Exception:
            res_min = 1  # fallback

    # SQL: use make_interval(mins => :x) so we can bind safely
    sql = text("""
        WITH b AS (
          SELECT time_bucket(make_interval(mins => :res_min), ts) AS bucket, ts, price
          FROM prices
          WHERE symbol = :symbol
            AND ts >= now() - make_interval(mins => :lookback_min)
        ),
        agg AS (
          SELECT bucket, MIN(price) AS low, MAX(price) AS high
          FROM b
          GROUP BY bucket
        ),
        o AS (
          SELECT DISTINCT ON (bucket) bucket, price AS open
          FROM b
          ORDER BY bucket, ts ASC
        ),
        c AS (
          SELECT DISTINCT ON (bucket) bucket, price AS close
          FROM b
          ORDER BY bucket, ts DESC
        )
        SELECT agg.bucket, o.open, agg.high, agg.low, c.close
        FROM agg
        JOIN o USING (bucket)
        JOIN c USING (bucket)
        ORDER BY agg.bucket;
    """)

    try:
        rows = db.execute(
            sql,
            {
                "res_min": int(res_min),
                "lookback_min": int(lookback_minutes),
                "symbol": symbol,
            },
        ).all()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"OHLC query failed: {e}")

    out = []
    for r in rows:
        if r.open is None or r.high is None or r.low is None or r.close is None:
            continue
        out.append({
            "time": int(r.bucket.timestamp()),  # unix seconds
            "open": float(r.open),
            "high": float(r.high),
            "low": float(r.low),
            "close": float(r.close),
        })
    return out