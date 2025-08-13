// frontend/src/App.tsx
import { useState } from 'react';
import Candles from './Candles';

// Slider stops in order (per-chart)
const TF_KEYS = ['1m', '5m', '15m', '1h', '1D'] as const;
type TfKey = typeof TF_KEYS[number];

// Map UI keys -> Finnhub/aggregation resolution + lookback window (minutes)
const TF_MAP: Record<TfKey, { res: number | 'D'; lookback: number }> = {
  '1m':  { res: 1,   lookback: 390 * 5 },
  '5m':  { res: 5,   lookback: 390 * 10 },
  '15m': { res: 15,  lookback: 390 * 20 },
  '1h':  { res: 60,  lookback: 390 * 30 },
  '1D':  { res: 'D', lookback: 1440 * 365 },
};

const SYMBOLS = ['SPY', 'QQQ'] as const;
type Sym = typeof SYMBOLS[number];

type ChartCfg = {
  id: number;
  symbol: Sym;
  tfIdx: number; // index into TF_KEYS
};

export default function App() {
  // Dynamic list of charts
  const [charts, setCharts] = useState<ChartCfg[]>([
    { id: 1, symbol: 'SPY', tfIdx: 0 },
    { id: 2, symbol: 'QQQ', tfIdx: 0 },
  ]);
  const [nextId, setNextId] = useState(3);

  function addChart() {
    setCharts((prev) => [...prev, { id: nextId, symbol: 'SPY', tfIdx: 0 }]);
    setNextId((n) => n + 1);
  }

  function removeChart(id: number) {
    setCharts((prev) => prev.filter((c) => c.id !== id));
  }

  function updateChart(id: number, patch: Partial<ChartCfg>) {
    setCharts((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  // Fixed chart drawing height (same for all rows)
  const CHART_HEIGHT = 360; // px — adjust if you want taller charts

  // Compute grid-column span for each item using a 6-col grid:
  // - Normal rows of 3 → span 2 each (2+2+2 = 6)
  // - Last row with 2 items → span 3 each (3+3 = 6)
  // - Last row with 1 item → span 6 (full width)
  function spanForIndex(i: number, total: number): number {
    const rem = total % 3;               // items in last row (0,1,2)
    const lastRowStart = total - (rem === 0 ? 3 : rem);
    const inLastRow = i >= lastRowStart;

    if (!inLastRow) return 2;            // full rows of 3 → 2 each

    if (rem === 1) {
      return i === total - 1 ? 6 : 2;    // only the single last item goes full width
    }
    if (rem === 2) {
      return i >= total - 2 ? 3 : 2;     // last two items split 50/50
    }
    // rem === 0 → normal 3 in last row
    return 2;
  }

  return (
    <div style={styles.page}>
      <Toolbar onAdd={addChart} count={charts.length} />

      <div style={styles.grid}>
        {charts.map((c, i) => {
          const key: TfKey = TF_KEYS[c.tfIdx];
          const cfg = TF_MAP[key];
          const span = spanForIndex(i, charts.length);
          return (
            <div key={c.id} style={{ gridColumn: `span ${span}` }}>
              <Panel title={`${c.symbol} • ${key}`} onRemove={() => removeChart(c.id)}>
                <div style={styles.controlsRow}>
                  <strong>Symbol:</strong>
                  <Select
                    value={c.symbol}
                    onChange={(v) => updateChart(c.id, { symbol: v as Sym })}
                    options={SYMBOLS as unknown as string[]}
                  />
                </div>

                <div style={{ width: '100%', height: CHART_HEIGHT, overflow: 'hidden' }}>
                  <Candles symbol={c.symbol} resolution={cfg.res} lookbackMinutes={cfg.lookback} />
                </div>

                <TfSlider
                  idx={c.tfIdx}
                  setIdx={(i) => updateChart(c.id, { tfIdx: i })}
                />
              </Panel>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Toolbar({ onAdd, count }: { onAdd: () => void; count: number }) {
  return (
    <div style={styles.toolbar}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={onAdd} style={styles.primaryBtn}>+ Add chart</button>
        <div style={{ opacity: 0.8 }}>Charts: {count}</div>
      </div>
      <div style={{ opacity: 0.8 }}>Each chart has its own timeframe slider below it.</div>
    </div>
  );
}

function Panel({ title, onRemove, children }: { title: string; onRemove: () => void; children: React.ReactNode }) {
  return (
    <div style={styles.card}>
      <div style={styles.cardHeaderRow}>
        <div style={styles.cardHeader}>{title}</div>
        <button onClick={onRemove} style={styles.removeBtn}>Remove</button>
      </div>
      {children}
    </div>
  );
}

function TfSlider({ idx, setIdx }: { idx: number; setIdx: (i: number) => void }) {
  const percent = (idx / (TF_KEYS.length - 1)) * 100;
  const label = TF_KEYS[idx];
  return (
    <div style={{ padding: '10px 8px 2px' }}>
      <div style={{ position: 'relative' }}>
        {/* Floating label above the thumb */}
        <div
          style={{
            position: 'absolute',
            left: `${percent}%`,
            transform: 'translateX(-50%)',
            top: -18,
            fontSize: 12,
            color: '#fff',
            opacity: 0.9,
            pointerEvents: 'none',
          }}
        >
          {label}
        </div>
        <input
          type="range"
          min={0}
          max={TF_KEYS.length - 1}
          step={1}
          value={idx}
          onChange={(e) => setIdx(Number(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>
      <div style={styles.marksRow}>
        {TF_KEYS.map((k, i) => (
          <div key={k} style={styles.markWrap}>
            <div style={{ ...styles.tick, opacity: idx === i ? 1 : 0.5 }} />
            <div style={{ ...styles.markLabel, opacity: idx === i ? 1 : 0.65 }}>{k}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: '#141414',
        color: '#fff',
        border: '1px solid #444',
        borderRadius: 8,
        padding: '6px 10px',
      }}
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
  );
}

const styles: Record<string, any> = {
  page: {
    minHeight: '100vh',
    background: '#0f0f0f',
    color: '#fff',
    fontFamily: 'system-ui',
    padding: 16,
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    border: '1px solid #262626',
    borderRadius: 12,
    marginBottom: 12,
    background: '#121212',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, 1fr)',
    minHeight: 'calc(100vh - 70px)',
    overflowY: 'auto',
    gap: 12,
  },
  card: {
    background: '#141414',
    border: '1px solid #262626',
    borderRadius: 12,
    padding: 8,
    overflow: 'hidden',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
  },
  cardHeaderRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
  },
  cardHeader: {
    fontWeight: 700,
    padding: '4px 8px 8px',
    opacity: 0.9,
  },
  controlsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '2px 8px',
  },
  marksRow: {
    display: 'grid',
    gridTemplateColumns: `repeat(${TF_KEYS.length}, 1fr)`,
    marginTop: 6,
    gap: 4,
  },
  markWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  tick: {
    width: 2,
    height: 8,
    background: '#666',
    marginBottom: 2,
  },
  markLabel: {
    fontSize: 12,
  },
  primaryBtn: {
    padding: '6px 10px',
    borderRadius: 8,
    border: '1px solid #1d4ed8',
    background: '#1d4ed8',
    color: '#fff',
    cursor: 'pointer',
  },
  removeBtn: {
    padding: '4px 8px',
    borderRadius: 8,
    border: '1px solid #444',
    background: 'transparent',
    color: '#fff',
    cursor: 'pointer',
  },
};