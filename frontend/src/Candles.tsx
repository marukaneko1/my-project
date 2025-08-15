// src/Candles.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, ISeriesApi, LineStyle } from "lightweight-charts";
import IndicatorsWorker from "./indicators.worker?worker";

// ---------- Props ----------
type Props = {
  symbol: string;               // "SPY" | "QQQ"
  resolution: number | "D";     // 1,5,15,60 or "D"
  lookbackMinutes: number;
};

// ---------- API base / WS util ----------
const API_BASE =
  (import.meta as any).env?.VITE_API_BASE ??
  `${window.location.protocol}//${window.location.hostname}:8000`;

function wsFromHttp(httpBase: string) {
  const url = new URL(httpBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString().replace(/\/$/, "") + "/ws/prices";
}

// ---------- Indicator worker message shapes ----------
type InBar = { time: number; open: number; high: number; low: number; close: number; volume?: number };

type IndicatorRequest =
  | { type: "warmup" }
  | {
      type: "compute";
      payload: {
        bars: InBar[]; // newest last
        indicators: Array<
          | { kind: "SMA"; period: number; source?: "close" | "open" | "hl2" | "hlc3" }
          | { kind: "EMA"; period: number; source?: "close" | "open" | "hl2" | "hlc3" }
          | { kind: "RSI"; period: number; source?: "close" | "open" }
        >;
      };
    };

type IndicatorResponse =
  | { ok: true; results: Record<string, Array<number | null>> }
  | { ok: false; error: string };

// ---------- UI Config ----------
type Source = "close" | "open" | "hl2" | "hlc3";
type Cfg = {
  sma: { enabled: boolean; period: number; color: string; source: Source };
  ema: { enabled: boolean; period: number; color: string; source: Source };
  rsi: { enabled: boolean; period: number; color: string };
};

const DEFAULT_CFG: Cfg = {
  sma: { enabled: true, period: 20, color: "#4fc3f7", source: "close" },
  ema: { enabled: true, period: 50, color: "#ffcc80", source: "close" },
  rsi: { enabled: true, period: 14, color: "#f5a623" },
};

export default function Candles({ symbol, resolution, lookbackMinutes }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // chart + series
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  // overlay price-indicator series (SMA/EMA) by label
  const lineSeriesMapRef = useRef<Record<string, ISeriesApi<"Line">>>({});

  // RSI on its own price scale + guide lines
  const rsiSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiLinesRef = useRef<{ overbought?: any; oversold?: any }>({});

  // data cache so we can recompute indicators
  const barsRef = useRef<InBar[]>([]);

  // worker
  const workerRef = useRef<Worker | null>(null);
  const workerReadyRef = useRef(false);

  // ws
  const wsRef = useRef<WebSocket | null>(null);
  const wsTimerRef = useRef<number | null>(null);

  // debouncer
  const computeTimerRef = useRef<number | null>(null);

  // UI state
  const [cfg, setCfg] = useState<Cfg>(DEFAULT_CFG);
  const indicatorList = useMemo(() => {
    const list: NonNullable<IndicatorRequest["payload"]>["indicators"] = [];
    if (cfg.sma.enabled) list.push({ kind: "SMA", period: cfg.sma.period, source: cfg.sma.source });
    if (cfg.ema.enabled) list.push({ kind: "EMA", period: cfg.ema.period, source: cfg.ema.source });
    if (cfg.rsi.enabled) list.push({ kind: "RSI", period: cfg.rsi.period, source: "close" });
    return list;
  }, [cfg]);

  // ---------- Create chart once ----------
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: el.clientWidth || 300,
      height: el.clientHeight || 200,
      layout: { background: { color: "#141414" }, textColor: "#DDD" },
      grid: { vertLines: { color: "#262626" }, horzLines: { color: "#262626" } },
      rightPriceScale: { borderColor: "#303030" },
      timeScale: { borderColor: "#303030" },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderUpColor: "#26a69a",
      borderDownColor: "#ef5350",
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    // DO NOT call chart.priceScale('rsi') before a series uses it.
    // We create the RSI series lazily; if enabled by default, create now:
    if (DEFAULT_CFG.rsi.enabled) ensureRsiSeries();

    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      chart.applyOptions({ width: Math.max(0, width), height: Math.max(0, height) });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      try { if (rsiSeriesRef.current) chart.removeSeries(rsiSeriesRef.current); } catch {}
      Object.values(lineSeriesMapRef.current).forEach((s) => { try { chart.removeSeries(s); } catch {} });
      lineSeriesMapRef.current = {};
      rsiLinesRef.current = {};
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      rsiSeriesRef.current = null;
      barsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Init indicator worker once ----------
  useEffect(() => {
    try {
      const w = new IndicatorsWorker();
      workerRef.current = w;

      const onMsg = (ev: MessageEvent<IndicatorResponse>) => {
        if ((ev.data as any)?.ok && !workerReadyRef.current) {
          workerReadyRef.current = true; // warmup ack
          console.log("[indicators] worker warmup: ready");
        }
      };
      w.addEventListener("message", onMsg);
      w.postMessage({ type: "warmup" } as IndicatorRequest);

      return () => {
        w.removeEventListener("message", onMsg);
        try { w.terminate(); } catch {}
        workerRef.current = null;
        workerReadyRef.current = false;
      };
    } catch (e) {
      console.warn("[indicators] worker failed to start; indicators disabled", e);
      workerRef.current = null;
      workerReadyRef.current = false;
    }
  }, []);

  // ---------- Load historical candles ----------
  useEffect(() => {
    let aborted = false;

    async function load() {
      try {
        const url =
          `${API_BASE}/ohlc?symbol=${encodeURIComponent(symbol)}` +
          `&resolution=${encodeURIComponent(String(resolution))}` +
          `&lookback_minutes=${encodeURIComponent(String(lookbackMinutes))}`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const rows: { time: number; open: number; high: number; low: number; close: number }[] = await r.json();
        if (aborted) return;

        const data: InBar[] = rows.map((d) => ({
          time: typeof d.time === "number" ? d.time : Math.floor(Number(d.time) || 0),
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
        }));

        barsRef.current = data;
        candleSeriesRef.current?.setData(data);
        chartRef.current?.timeScale().fitContent();

        computeIndicators(); // draw indicators with current cfg
      } catch (e) {
        console.warn("candles load error", e);
      }
    }

    load();
    return () => { aborted = true; };
  }, [symbol, resolution, lookbackMinutes]);

  // ---------- Live updates with simple reconnect ----------
  useEffect(() => {
    const wsUrl = wsFromHttp(API_BASE);

    function connect(delay = 0) {
      if (wsTimerRef.current) {
        window.clearTimeout(wsTimerRef.current);
        wsTimerRef.current = null;
      }
      wsTimerRef.current = window.setTimeout(() => {
        try {
          const ws = new WebSocket(wsUrl);
          wsRef.current = ws;

          ws.onmessage = (ev) => {
            try {
              const msg = JSON.parse(ev.data);
              if (msg?.type !== "prices" || !Array.isArray(msg.data)) return;

              for (const p of msg.data) {
                if (p.symbol !== symbol) continue;
                const t = Math.floor(new Date(p.ts).getTime() / 1000);
                const price = Number(p.price);

                // Update candle as a “synthetic” OHLC for the tick
                candleSeriesRef.current?.update({ time: t, open: price, high: price, low: price, close: price });

                // keep bars array aligned
                const arr = barsRef.current;
                const last = arr[arr.length - 1];
                if (last && last.time === t) {
                  last.open = price; last.high = price; last.low = price; last.close = price;
                } else {
                  arr.push({ time: t, open: price, high: price, low: price, close: price });
                }
              }

              scheduleCompute();
            } catch {}
          };

          ws.onclose = () => connect(1500);
          ws.onerror = () => { try { ws.close(); } catch {} };
        } catch {
          connect(1500);
        }
      }, delay);
    }

    connect(0);
    return () => {
      if (wsTimerRef.current) { window.clearTimeout(wsTimerRef.current); wsTimerRef.current = null; }
      try { wsRef.current?.close(); } catch {}
      wsRef.current = null;
    };
  }, [symbol]);

  // ---------- Recompute when cfg changes ----------
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // RSI on/off + color
    if (cfg.rsi.enabled) {
      ensureRsiSeries();
      rsiSeriesRef.current?.applyOptions({ color: cfg.rsi.color });
    } else if (rsiSeriesRef.current) {
      try { chart.removeSeries(rsiSeriesRef.current); } catch {}
      rsiSeriesRef.current = null;
      rsiLinesRef.current = {};
    }

    // SMA/EMA color updates and pruning
    const desiredLabels = currentPriceLabels();
    for (const [label, s] of Object.entries(lineSeriesMapRef.current)) {
      if (!desiredLabels.has(label)) {
        try { chart.removeSeries(s); } catch {}
        delete lineSeriesMapRef.current[label];
      }
    }
    const smaLabel = labelFor("SMA", cfg.sma.period, cfg.sma.source);
    const emaLabel = labelFor("EMA", cfg.ema.period, cfg.ema.source);
    lineSeriesMapRef.current[smaLabel]?.applyOptions({ color: cfg.sma.color });
    lineSeriesMapRef.current[emaLabel]?.applyOptions({ color: cfg.ema.color });

    scheduleCompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg]);

  // ---------- Debounced compute ----------
  function scheduleCompute() {
    if (!workerRef.current || !workerReadyRef.current) return;
    if (computeTimerRef.current) window.clearTimeout(computeTimerRef.current);
    computeTimerRef.current = window.setTimeout(() => {
      computeIndicators();
      computeTimerRef.current = null;
    }, 150);
  }

  // ---------- Helpers ----------
  function ensureLineSeries(label: string, color: string) {
    const chart = chartRef.current;
    if (!chart) return null;
    if (!lineSeriesMapRef.current[label]) {
      lineSeriesMapRef.current[label] = chart.addLineSeries({
        color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: true,
      });
    } else {
      lineSeriesMapRef.current[label].applyOptions({ color });
    }
    return lineSeriesMapRef.current[label];
  }

  function ensureRsiSeries() {
    const chart = chartRef.current;
    if (!chart) return;
    if (!rsiSeriesRef.current) {
      // 1) create a series that uses the custom scale id
      rsiSeriesRef.current = chart.addLineSeries({
        color: cfg.rsi.color,
        lineWidth: 1,
        priceScaleId: "rsi",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      // 2) only now the priceScale('rsi') exists; safe to configure it
      chart.priceScale("rsi").applyOptions({
        scaleMargins: { top: 0.80, bottom: 0.02 },
        borderColor: "#303030",
      });
      // 3) guide lines
      rsiLinesRef.current.overbought = rsiSeriesRef.current.createPriceLine({
        price: 70, color: "#666", lineStyle: LineStyle.Dashed, lineWidth: 1, title: "RSI 70",
      });
      rsiLinesRef.current.oversold = rsiSeriesRef.current.createPriceLine({
        price: 30, color: "#666", lineStyle: LineStyle.Dashed, lineWidth: 1, title: "RSI 30",
      });
    }
  }

  function toLineData(bars: InBar[], values: Array<number | null>) {
    const out: Array<{ time: number; value: number }> = [];
    for (let i = 0; i < bars.length; i++) {
      const v = values[i];
      if (v == null || !Number.isFinite(v)) continue;
      out.push({ time: bars[i].time, value: v });
    }
    return out;
  }

  function labelFor(kind: "SMA" | "EMA", period: number, source: Source) {
    return `${kind}(${period},${source})`;
  }

  function currentPriceLabels() {
    const set = new Set<string>();
    if (cfg.sma.enabled) set.add(labelFor("SMA", cfg.sma.period, cfg.sma.source));
    if (cfg.ema.enabled) set.add(labelFor("EMA", cfg.ema.period, cfg.ema.source));
    return set;
  }

  // ---------- Actual indicator compute ----------
  function computeIndicators() {
    const w = workerRef.current;
    if (!w || !workerReadyRef.current) return;
    const bars = barsRef.current;
    if (!bars || bars.length < 2) return;

    const req: IndicatorRequest = {
      type: "compute",
      payload: { bars, indicators: indicatorList },
    };

    const once = (ev: MessageEvent<IndicatorResponse>) => {
      if (!ev.data?.ok) {
        console.warn("indicator error:", (ev.data as any)?.error);
        return;
      }
      const results = ev.data.results;

      // prune any series we no longer want
      const desired = currentPriceLabels();
      for (const [label, s] of Object.entries(lineSeriesMapRef.current)) {
        if (!desired.has(label)) {
          try { chartRef.current?.removeSeries(s); } catch {}
          delete lineSeriesMapRef.current[label];
        }
      }

      // SMA
      if (cfg.sma.enabled) {
        const label = labelFor("SMA", cfg.sma.period, cfg.sma.source);
        const arr = results[label];
        if (arr) ensureLineSeries(label, cfg.sma.color)?.setData(toLineData(bars, arr));
      }

      // EMA
      if (cfg.ema.enabled) {
        const label = labelFor("EMA", cfg.ema.period, cfg.ema.source);
        const arr = results[label];
        if (arr) ensureLineSeries(label, cfg.ema.color)?.setData(toLineData(bars, arr));
      }

      // RSI
      if (cfg.rsi.enabled && rsiSeriesRef.current) {
        const rsiLabel = `RSI(${cfg.rsi.period},close)`;
        const rsi = results[rsiLabel];
        if (rsi) rsiSeriesRef.current.setData(toLineData(bars, rsi));
      } else if (!cfg.rsi.enabled && rsiSeriesRef.current) {
        rsiSeriesRef.current.setData([]); // hidden
      }
    };

    w.addEventListener("message", once, { once: true });
    w.postMessage(req);
  }

  // ---------- UI: Controls ----------
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* Control panel */}
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          zIndex: 5,
          background: "rgba(20,20,20,0.9)",
          border: "1px solid #333",
          borderRadius: 10,
          padding: 10,
          color: "#fff",
          fontSize: 12,
          display: "grid",
          gap: 8,
          gridTemplateColumns: "1fr",
          maxWidth: 320,
        }}
      >
        <strong style={{ fontSize: 13 }}>Indicators</strong>

        {/* SMA */}
        <section style={{ display: "grid", gap: 6 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={cfg.sma.enabled}
              onChange={(e) => setCfg(v => ({ ...v, sma: { ...v.sma, enabled: e.target.checked } }))}
            />
            SMA
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span>Period</span>
            <input
              type="number"
              min={1}
              value={cfg.sma.period}
              onChange={(e) => setCfg(v => ({ ...v, sma: { ...v.sma, period: clampInt(e.target.value, 1, 1000) } }))}
              style={num}
            />
            <span>Src</span>
            <select
              value={cfg.sma.source}
              onChange={(e) => setCfg(v => ({ ...v, sma: { ...v.sma, source: e.target.value as Source } }))}
              style={sel}
            >
              <option value="close">close</option>
              <option value="open">open</option>
              <option value="hl2">hl2</option>
              <option value="hlc3">hlc3</option>
            </select>
            <input
              type="color"
              value={cfg.sma.color}
              onChange={(e) => setCfg(v => ({ ...v, sma: { ...v.sma, color: e.target.value } }))}
              title="SMA color"
              style={color}
            />
          </div>
        </section>

        {/* EMA */}
        <section style={{ display: "grid", gap: 6 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={cfg.ema.enabled}
              onChange={(e) => setCfg(v => ({ ...v, ema: { ...v.ema, enabled: e.target.checked } }))}
            />
            EMA
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span>Period</span>
            <input
              type="number"
              min={1}
              value={cfg.ema.period}
              onChange={(e) => setCfg(v => ({ ...v, ema: { ...v.ema, period: clampInt(e.target.value, 1, 1000) } }))}
              style={num}
            />
            <span>Src</span>
            <select
              value={cfg.ema.source}
              onChange={(e) => setCfg(v => ({ ...v, ema: { ...v.ema, source: e.target.value as Source } }))}
              style={sel}
            >
              <option value="close">close</option>
              <option value="open">open</option>
              <option value="hl2">hl2</option>
              <option value="hlc3">hlc3</option>
            </select>
            <input
              type="color"
              value={cfg.ema.color}
              onChange={(e) => setCfg(v => ({ ...v, ema: { ...v.ema, color: e.target.value } }))}
              title="EMA color"
              style={color}
            />
          </div>
        </section>

        {/* RSI */}
        <section style={{ display: "grid", gap: 6 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={cfg.rsi.enabled}
              onChange={(e) => setCfg(v => ({ ...v, rsi: { ...v.rsi, enabled: e.target.checked } }))}
            />
            RSI
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span>Period</span>
            <input
              type="number"
              min={1}
              value={cfg.rsi.period}
              onChange={(e) => setCfg(v => ({ ...v, rsi: { ...v.rsi, period: clampInt(e.target.value, 1, 1000) } }))}
              style={num}
            />
            <input
              type="color"
              value={cfg.rsi.color}
              onChange={(e) => setCfg(v => ({ ...v, rsi: { ...v.rsi, color: e.target.value } }))}
              title="RSI color"
              style={color}
            />
          </div>
        </section>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setCfg(DEFAULT_CFG)} style={btn} title="Reset indicators to defaults">
            Reset
          </button>
        </div>
      </div>

      {/* Chart container */}
      <div ref={wrapRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );

  // ---------- small UI helpers ----------
  function clampInt(v: string, min: number, max: number) {
    const n = Math.max(min, Math.min(max, Math.floor(Number(v) || min)));
    return n;
  }
}

const num: React.CSSProperties = { width: 72, padding: "4px 6px", background: "#111", color: "#fff", border: "1px solid #333", borderRadius: 6 };
const sel: React.CSSProperties = { padding: "4px 6px", background: "#111", color: "#fff", border: "1px solid #333", borderRadius: 6 };
const color: React.CSSProperties = { width: 34, height: 26, padding: 0, border: "1px solid #333", borderRadius: 6, background: "transparent" };
const btn: React.CSSProperties = { padding: "6px 10px", background: "#000", color: "#fff", border: "1px solid #333", borderRadius: 8, cursor: "pointer" };