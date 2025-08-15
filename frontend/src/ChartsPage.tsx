import React, { useMemo, useState } from "react";
import Candles from "./Candles";

const TF = [
  { label: "1m", value: 1 as number | "D", lookback: 390 },
  { label: "5m", value: 5 as number | "D", lookback: 390 * 2 },
  { label: "15m", value: 15 as number | "D", lookback: 390 * 3 },
  { label: "1h", value: 60 as number | "D", lookback: 60 * 24 * 3 },
  { label: "1D", value: "D" as number | "D", lookback: 1440 * 180 },
];

type ChartItem = { id: string; symbol: "SPY" | "QQQ"; tfIndex: number };

const pageWrap: React.CSSProperties = {
  width: "100%",
  minHeight: "100vh",
  boxSizing: "border-box",
  padding: 16,
  background: "#0f0f0f",
  color: "#fff",
};
const GRID_ROW_HEIGHT = 420;
const card: React.CSSProperties = {
  width: "100%",
  height: "100%",
  background: "#141414",
  borderRadius: 12,
  overflow: "hidden",
  border: "1px solid #262626",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
};
const iconBtn: React.CSSProperties = {
  border: "1px solid #333",
  background: "#000",
  color: "#fff",
  borderRadius: 8,
  padding: "6px 10px",
  cursor: "pointer",
};
function uid() { return Math.random().toString(36).slice(2, 9); }

export default function ChartsPage() {
  const [charts, setCharts] = useState<ChartItem[]>([
    { id: uid(), symbol: "SPY", tfIndex: 0 },
    { id: uid(), symbol: "QQQ", tfIndex: 0 },
  ]);

  const cols = useMemo(() => Math.min(charts.length || 1, 3), [charts.length]);
  const gridStyle: React.CSSProperties = useMemo(
    () => ({
      display: "grid",
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gridAutoRows: `${GRID_ROW_HEIGHT}px`,
      gap: 12,
      alignItems: "stretch",
      alignContent: "start",
    }),
    [cols]
  );

  function addChart(symbol: "SPY" | "QQQ" = charts.length % 2 ? "QQQ" : "SPY") {
    setCharts((prev) => [...prev, { id: uid(), symbol, tfIndex: 0 }]);
  }
  function removeChart(id: string) {
    setCharts((prev) => prev.filter((c) => c.id !== id));
  }
  function setSymbol(id: string, symbol: "SPY" | "QQQ") {
    setCharts((prev) => prev.map((c) => (c.id === id ? { ...c, symbol } : c)));
  }
  function setTfIndex(id: string, idx: number) {
    setCharts((prev) => prev.map((c) => (c.id === id ? { ...c, tfIndex: idx } : c)));
  }

  return (
    <div style={pageWrap}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, paddingRight: 120 }}>
        <h1 style={{ margin: 0, fontSize: 24, flex: 1 }}>Supercharts</h1>
        <button style={iconBtn} onClick={() => addChart("SPY")}>+ Add SPY</button>
        <button style={iconBtn} onClick={() => addChart("QQQ")}>+ Add QQQ</button>
      </div>

      <div style={gridStyle}>
        {charts.map((c) => {
          const tf = TF[c.tfIndex];
          return (
            <div key={c.id} style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: "1px solid #222", background: "#0f0f0f" }}>
                <select
                  value={c.symbol}
                  onChange={(e) => setSymbol(c.id, e.target.value as "SPY" | "QQQ")}
                  style={{ background: "#000", color: "#fff", border: "1px solid #333", borderRadius: 8, padding: "6px 8px" }}
                >
                  <option value="SPY">SPY</option>
                  <option value="QQQ">QQQ</option>
                </select>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  <button style={iconBtn} onClick={() => removeChart(c.id)}>Remove</button>
                </div>
              </div>

              <div style={{ flex: 1, minHeight: 0 }}>
                <Candles symbol={c.symbol} resolution={tf.value} lookbackMinutes={tf.lookback} />
              </div>

              <div style={{ padding: "8px 10px", borderTop: "1px solid #222", background: "#0f0f0f" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, opacity: 0.8 }}>
                  {TF.map((t, i) => (
                    <span key={t.label} style={{ width: `${100 / (TF.length - 1)}%`, textAlign: i === 0 ? "left" : i === TF.length - 1 ? "right" : "center" }}>
                      {t.label}
                    </span>
                  ))}
                </div>
                <input
                  type="range"
                  min={0}
                  max={TF.length - 1}
                  step={1}
                  value={c.tfIndex}
                  onChange={(e) => setTfIndex(c.id, Number(e.target.value))}
                  style={{ width: "100%", marginTop: 8 }}
                />
                <div style={{ textAlign: "center", marginTop: 4, fontSize: 12 }}>
                  Selected: <strong>{TF[c.tfIndex].label}</strong>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}