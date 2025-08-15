// src/Journal.tsx
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

const btn: React.CSSProperties = {
  display: "inline-block",
  padding: "8px 12px",
  background: "#000",
  color: "#fff",
  border: "1px solid #333",
  borderRadius: 10,
  cursor: "pointer",
  textDecoration: "none",
};

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }

export default function Journal() {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const { year, monthName, grid } = useMemo(() => {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const monthStart = startOfMonth(cursor);
    const monthEnd = endOfMonth(cursor);

    const firstWeekday = monthStart.getDay(); // 0 Sun .. 6 Sat
    const daysInMonth = monthEnd.getDate();

    const cells: Array<{ day?: number; date?: Date }> = [];
    // leading blanks
    for (let i = 0; i < firstWeekday; i++) cells.push({});
    // actual days
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, date: new Date(y, m, d) });
    }
    // pad to full weeks (42 cells = 6x7)
    while (cells.length % 7 !== 0) cells.push({});

    // chunk to rows of 7
    const rows: typeof cells[] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

    return {
      year: y,
      monthName: cursor.toLocaleString(undefined, { month: "long" }),
      grid: rows,
    };
  }, [cursor]);

  const today = new Date();
  const isToday = (d?: Date) =>
    d &&
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff" }}>
      <div style={{ position: "fixed", top: 12, right: 12 }}>
        <Link to="/" style={{ ...btn }}>Home</Link>
      </div>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "80px 16px 24px" }}>
        <h1 style={{ marginTop: 0 }}>Journal</h1>

        {/* Header controls */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 12,
        }}>
          <button style={btn} onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
            ◀ Prev
          </button>
          <div style={{ fontWeight: 700, fontSize: 18 }}>
            {monthName} {year}
          </div>
          <button style={btn} onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
            Next ▶
          </button>
        </div>

        {/* Weekday header */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 6,
          marginBottom: 6,
          fontSize: 12,
          opacity: 0.8,
        }}>
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => (
            <div key={d} style={{ textAlign: "center" }}>{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div style={{
          display: "grid",
          gridTemplateRows: `repeat(${grid.length}, 1fr)`,
          gap: 6,
        }}>
          {grid.map((row, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
              {row.map((cell, j) => {
                const active = !!cell.day;
                const highlight = isToday(cell.date);
                return (
                  <div
                    key={j}
                    style={{
                      minHeight: 96,
                      background: active ? "#141414" : "transparent",
                      border: active ? "1px solid #262626" : "1px dashed #222",
                      borderRadius: 10,
                      padding: 8,
                      position: "relative",
                      boxShadow: active ? "0 1px 0 rgba(255,255,255,0.04) inset" : undefined,
                    }}
                  >
                    {active && (
                      <div style={{
                        position: "absolute",
                        top: 6, right: 8,
                        fontSize: 12,
                        opacity: 0.8,
                        padding: "2px 6px",
                        borderRadius: 6,
                        background: highlight ? "#1f3b1f" : "transparent",
                        color: highlight ? "#b6f2b6" : "#fff",
                        border: highlight ? "1px solid #2a5a2a" : "none",
                      }}>
                        {cell.day}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Quick jump to today */}
        <div style={{ marginTop: 12 }}>
          <button
            style={btn}
            onClick={() => {
              const now = new Date();
              setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
            }}
          >
            Today
          </button>
        </div>
      </div>
    </div>
  );
}