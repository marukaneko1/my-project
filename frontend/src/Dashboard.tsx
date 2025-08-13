import { useEffect, useMemo, useRef, useState } from "react";

const WS_URL = "ws://127.0.0.1:8000/ws/prices";
type Tick = { ts: string; symbol: "SPY" | "QQQ" | string; price: number };

type PanelState = {
  latest?: Tick;
  history: Tick[]; // newest first
};

const MAX_POINTS = 60;   // keep last N points for sparkline
const SEED_LIMIT = 60;   // how many rows to fetch initially

export default function Dashboard() {
  const [spy, setSpy] = useState<PanelState>({ history: [] });
  const [qqq, setQqq] = useState<PanelState>({ history: [] });

  // ---- Seed initial data from REST
  useEffect(() => {
    let cancelled = false;

    async function seed(symbol: "SPY" | "QQQ", setter: (s: PanelState) => void) {
      try {
        const r = await fetch(
          `http://127.0.0.1:8000/prices?symbol=${symbol}&limit=${SEED_LIMIT}`
        );
        if (!r.ok) return;
        const rows: Tick[] = await r.json(); // assume newest first
        if (cancelled) return;
        setter({ latest: rows[0], history: rows });
      } catch {
        // ignore
      }
    }

    seed("SPY", setSpy);
    seed("QQQ", setQqq);

    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Live updates via a single WebSocket
  const wsRef = useRef<WebSocket | null>(null);
  useEffect(() => {
    let backoff = 1000;

    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        backoff = 1000;
        try { ws.send("hello"); } catch {}
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          // server: { type:"prices", data:[{ ts, symbol, price }, ...] }
          if (!msg || msg.type !== "prices" || !Array.isArray(msg.data)) return;

          for (const raw of msg.data as Tick[]) {
            if (raw.symbol === "SPY") {
              setSpy((prev) => mergeTick(prev, raw));
            } else if (raw.symbol === "QQQ") {
              setQqq((prev) => mergeTick(prev, raw));
            }
          }
        } catch {
          // ignore non-JSON
        }
      };

      ws.onclose = () => {
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 15000);
      };

      ws.onerror = () => {
        try { ws.close(); } catch {}
      };
    }

    connect();
    return () => {
      try { wsRef.current?.close(); } catch {}
      wsRef.current = null;
    };
  }, []);

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Live SPY & QQQ</h1>

      {/* Fixed order: SPY left, QQQ right. On small screens they stack: SPY on top, QQQ below */}
      <div style={styles.grid}>
        <Tile symbol="SPY" state={spy} />
        <Tile symbol="QQQ" state={qqq} />
      </div>
    </div>
  );
}

/** Merge an incoming tick into a panel state (prepend + de-dupe + cap) */
function mergeTick(prev: PanelState, tick: Tick): PanelState {
  if (!tick?.ts) return prev;
  const exists = prev.history.find((h) => h.ts === tick.ts);
  const history = exists ? prev.history : [tick, ...prev.history].slice(0, MAX_POINTS);
  return { latest: tick, history };
}

function Tile({ symbol, state }: { symbol: "SPY" | "QQQ"; state: PanelState }) {
  const price = state.latest?.price;
  const time = state.latest ? new Date(state.latest.ts).toLocaleTimeString() : "waiting…";
  const series = useMemo(
    () => [...state.history].reverse().map((t) => t.price),
    [state.history]
  );

  return (
    <div style={styles.card}>
      <div style={styles.headerRow}>
        <div style={styles.symbol}>{symbol}</div>
        <div style={styles.time}>{time}</div>
      </div>
      <div style={styles.price}>{price != null ? `$${price}` : "—"}</div>
      <Sparkline values={series} width={440} height={72} />
    </div>
  );
}

// ---- Tiny sparkline (pure SVG, no libs)
function Sparkline({
  values,
  width = 300,
  height = 60,
  padding = 8,
}: {
  values: number[];
  width?: number;
  height?: number;
  padding?: number;
}) {
  if (!values || values.length < 2) {
    return (
      <div style={styles.sparkEmpty(height)}>no data</div>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  const stepX = innerW / (values.length - 1);
  const points = values.map((v, i) => {
    const x = padding + i * stepX;
    const y = padding + innerH - ((v - min) / span) * innerH; // invert
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="white"
        strokeOpacity="0.9"
        strokeWidth="2"
      />
    </svg>
  );
}

// ---- Inline “CSS”
const styles: Record<string, any> = {
  page: {
    minHeight: "100vh",
    background: "#0f0f0f",
    color: "#fff",
    fontFamily: "system-ui",
    padding: 16,
  },
  title: {
    margin: 0,
    marginBottom: 16,
    fontWeight: 800,
    letterSpacing: 0.2,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
    alignItems: "stretch",
    // Mobile: stack to 1 column
    // Using a simple runtime check via container width would need a resize observer.
    // For now, rely on CSS min() via inline 'style' is limited, so we keep two columns.
    // If you want a CSS file, we can add @media. Here's a JS-powered quick fallback:
  } as React.CSSProperties,
  card: {
    background: "#141414",
    border: "1px solid #262626",
    borderRadius: 12,
    padding: 12,
    boxShadow: "0 1px 0 rgba(255,255,255,0.04) inset",
  },
  headerRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    marginBottom: 8,
  },
  symbol: { fontSize: 18, fontWeight: 700 },
  time: { fontSize: 14, opacity: 0.75 },
  price: { fontSize: 32, fontWeight: 800, marginBottom: 8 },
  sparkEmpty: (h: number) => ({
    height: h,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.5,
    border: "1px dashed #333",
    borderRadius: 8,
  }),
};