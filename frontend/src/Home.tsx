// src/pages/Home.tsx
import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#0f0f0f",
        color: "#fff",
      }}
    >
      {/* Your main home content */}
      <main style={{ flex: 1, padding: 24 }}>
        <h1 style={{ marginTop: 0 }}>Home</h1>
        <p>Welcome! Pick a page from here.</p>
        {/* ...whatever else you already have... */}
      </main>

      {/* Bottom bar with Dashboard button */}
      <footer
        style={{
          position: "sticky",
          bottom: 0,
          borderTop: "1px solid #222",
          background: "#111",
          padding: 16,
        }}
      >
        <Link
          to="/dashboard"
          style={{
            display: "block",
            textAlign: "center",
            width: "100%",
            padding: "14px 16px",
            background: "#2563eb",
            color: "#fff",
            textDecoration: "none",
            borderRadius: 10,
            fontWeight: 600,
          }}
        >
          Go to Dashboard
        </Link>
      </footer>
    </div>
  );
}