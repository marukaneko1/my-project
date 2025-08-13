import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, CandlestickSeries, type IChartApi } from 'lightweight-charts';

type Bar = { time: number; open: number; high: number; low: number; close: number; volume?: number };
type TickMsg = { ts: string; symbol: string; price: number };
type WsPacket = { type: "prices"; data: TickMsg[] };

const WS_URL = "ws://127.0.0.1:8000/ws/prices";

export default function Candles({
  symbol,
  resolution = 1 as number | 'D', // minutes per bar or 'D' for daily
  lookbackMinutes = 390,          // ~one session for 1m bars
}: {
  symbol: "SPY" | "QQQ";
  resolution?: number | 'D';
  lookbackMinutes?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<any>(null);
  const [loading, setLoading] = useState(false);
  const currentBarRef = useRef<Bar | null>(null);

  // bucket a timestamp to the minute (or resolution minutes)
  function bucket(timeSec: number, res: number | 'D') {
    if (res === 'D') {
      const d = new Date(timeSec * 1000);
      d.setUTCHours(0, 0, 0, 0);
      return Math.floor(d.getTime() / 1000);
    }
    const resMin = res as number;
    return Math.floor(timeSec / (60 * resMin)) * (60 * resMin);
  }

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: { background: { color: "#0f0f0f" }, textColor: "#ddd" },
      grid: { vertLines: { color: "#1d1d1d" }, horzLines: { color: "#1d1d1d" } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#2a2a2a" },
      rightPriceScale: { borderColor: "#2a2a2a" },
      crosshair: { mode: 1 },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: 'green',
      downColor: 'red',
      borderUpColor: 'green',
      borderDownColor: 'red',
      wickUpColor: 'green',
      wickDownColor: 'red',
    });
    seriesRef.current = candleSeries;

    const handleResize = () => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({
        width: containerRef.current.clientWidth,
        height: Math.max(260, Math.floor(window.innerHeight * 0.4)),
      });
    };
    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // fetch initial bars
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const r = await fetch(
          `http://127.0.0.1:8000/ohlc?symbol=${symbol}&resolution=${resolution}&lookback_minutes=${lookbackMinutes}`
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const rows: Bar[] = await r.json();
        if (cancelled) return;
        if (seriesRef.current) {
          seriesRef.current.setData(rows);
          currentBarRef.current = rows[rows.length - 1] ?? null;
        }
      } catch (e) {
        console.error("load ohlc error", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [symbol, resolution, lookbackMinutes]);

  // live updates from your WS: update the last bar with incoming ticks
  useEffect(() => {
    let ws: WebSocket | null = null;
    let backoff = 1000;

    function connect() {
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        backoff = 1000;
        try { ws?.send("hi"); } catch {}
      };

      ws.onmessage = (ev) => {
        try {
          const pkt: WsPacket = JSON.parse(ev.data);
          if (pkt?.type !== "prices" || !Array.isArray(pkt.data)) return;

          // only care about the chosen symbol
          const hits = pkt.data.filter(d => d.symbol === symbol);
          if (hits.length === 0) return;

          // convert tick time to seconds
          for (const h of hits) {
            const tsSec = Math.floor(new Date(h.ts).getTime() / 1000);
            const barStart = bucket(tsSec, resolution);
            const price = h.price;

            let bar = currentBarRef.current;
            if (!bar || bar.time < barStart) {
              // new bar
              bar = {
                time: barStart,
                open: price,
                high: price,
                low: price,
                close: price,
              };
            } else if (bar.time === barStart) {
              // update bar
              bar = {
                ...bar,
                high: Math.max(bar.high, price),
                low: Math.min(bar.low, price),
                close: price,
              };
            } else {
              // (rare) tick older than current bar; ignore
              continue;
            }

            currentBarRef.current = bar;
            seriesRef.current?.update(bar);
          }
        } catch {
          /* ignore non-JSON */
        }
      };

      ws.onclose = () => {
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 15000);
      };

      ws.onerror = () => {
        try { ws?.close(); } catch {}
      };
    }

    connect();
    return () => { try { ws?.close(); } catch {} };
  }, [symbol, resolution]);

  return (
    <div style={{ background: "#0f0f0f", color: "#ddd" }}>
      <div style={{ padding: "8px 12px", display: "flex", alignItems: "baseline", gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{symbol} — {resolution}m</div>
        {loading && <div style={{ opacity: 0.7 }}>loading…</div>}
      </div>
      <div ref={containerRef} style={{ width: "100%", height: 360 }} />
    </div>
  );
}