import { useEffect, useMemo, useRef, useState } from "react";

const WS_URL = "ws://127.0.0.1:8000/ws/prices";
const ALLOWED = new Set(["QQQ", "SPY", "BINANCE:BTCUSDT", "BINANCE:ETHUSDT"]);

// inside Prices component
useEffect(() => {
  const ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log("Connected to price WS");
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg && msg.symbol && ALLOWED.has(msg.symbol)) {
        setData(prev => [
          { ts: msg.ts, symbol: msg.symbol, price: msg.price },
          ...prev.filter(p => !(p.symbol === msg.symbol && p.ts === msg.ts))
        ]);
      }
    } catch (err) {
      console.error("WS message parse error", err);
    }
  };

  ws.onerror = (err) => console.error("WS error", err);
  ws.onclose = () => console.log("WS closed");

  return () => ws.close();
}, []);
type Price = { ts: string; symbol: string; price: number };
const PRESETS = ["QQQ", "NDX", "SPX", "SPY"]; // NASDAQ-100 = NDX, S&P 500 = SPX

export default function Prices() {
  const [data, setData] = useState<Price[]>([]);
  const [symbol, setSymbol] = useState<string>("QQQ");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const timerRef = useRef<number | null>(null);

  async function load(sym = symbol) {
    try {
      setLoading(true);
      setError(null);
      const r = await fetch(`http://127.0.0.1:8000/prices?symbol=${encodeURIComponent(sym)}&limit=50`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  // load on mount and when symbol changes
  useEffect(() => {
    load(symbol);
  }, [symbol]);


  return (
    <div style={{ fontFamily: "system-ui", padding: 16 }}>
      <h2>Latest Prices</h2>

      {/* Preset chips */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {PRESETS.map(p => (
          <button
            key={p}
            onClick={() => setSymbol(p)}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #444",
              background: p === symbol ? "#222" : "transparent",
              color: "white",
              cursor: "pointer"
            }}
          >
            {p}
          </button>
        ))}
        <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />
          Auto refresh (5s)
        </label>
        <button onClick={() => load()} disabled={loading} style={{ padding: "6px 10px", borderRadius: 8 }}>
          {loading ? "Refreshing…" : "Refresh now"}
        </button>
      </div>

      <AddPrice onSaved={() => load()} defaultSymbol={symbol} />

      {error && <div style={{ color: "red", marginTop: 8 }}>Error: {error}</div>}

      <ul style={{ marginTop: 12 }}>
        {data.map((p, i) => (
          <li key={i}>
            {new Date(p.ts).toLocaleString()} — {p.symbol}: ${p.price}
          </li>
        ))}
      </ul>
      {!loading && !error && data.length === 0 && <div>No data for {symbol} yet — add one above.</div>}
    </div>
  );
}

function AddPrice({ onSaved, defaultSymbol }: { onSaved: () => void; defaultSymbol: string }) {
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [price, setPrice] = useState<number>(0);
  const [status, setStatus] = useState<"idle" | "saving" | "ok" | "err">("idle");

  useEffect(() => setSymbol(defaultSymbol), [defaultSymbol]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    try {
      const r = await fetch("http://127.0.0.1:8000/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, price }),
      });
      if (!r.ok) throw new Error();
      setStatus("ok");
      onSaved();
    } catch {
      setStatus("err");
    } finally {
      setTimeout(() => setStatus("idle"), 1000);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
      <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} placeholder="Symbol" />
      <input type="number" step="0.01" value={price} onChange={e => setPrice(Number(e.target.value))} placeholder="Price" />
      <button type="submit" disabled={status === "saving"}>{status === "saving" ? "Saving…" : "Add"}</button>
      {status === "ok" && <span style={{ color: "green" }}>Saved!</span>}
      {status === "err" && <span style={{ color: "red" }}>Failed</span>}
    </form>
  );
}