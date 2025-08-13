import Candles from "./Candles";

export default function ChartsPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#0f0f0f", color: "#fff", padding: 16 }}>
      <h1 style={{ marginTop: 0 }}>SPY & QQQ — Candles</h1>
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
      }}>
        <div style={{ background: "#141414", border: "1px solid #262626", borderRadius: 12, padding: 8 }}>
          <Candles symbol="SPY" resolution={1} lookbackMinutes={390} />
        </div>
        <div style={{ background: "#141414", border: "1px solid #262626", borderRadius: 12, padding: 8 }}>
          <Candles symbol="QQQ" resolution={1} lookbackMinutes={390} />
        </div>
      </div>
    </div>
  );
}
