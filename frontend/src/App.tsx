// src/App.tsx
import { Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import ChartsPage from "./ChartsPage";
import Dashboard from "./Dashboard";
import Blog from "./Blog";
import Journal from "./Journal";

// ---- Reusable button style ----
const btn: React.CSSProperties = {
  display: "block",
  textAlign: "center",
  padding: "12px 16px",
  background: "#000",
  color: "#fff",
  border: "1px solid #333",
  borderRadius: 10,
  textDecoration: "none",
};

function TopRightHome() {
  const loc = useLocation();
  if (loc.pathname === "/") return null;
  return (
    <div style={{ position: "fixed", top: 12, right: 12, zIndex: 10 }}>
      <Link to="/" style={{ ...btn, padding: "8px 12px" }}>Home</Link>
    </div>
  );
}

function News() { return <Blank title="news" />; }
function Algorithm() { return <Blank title="algorithm" />; }

function Blank({ title }: { title: string }) {
  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", padding: 16 }}>
      <TopRightHome />
      <h1 style={{ marginTop: 0, textTransform: "capitalize" }}>{title}</h1>
    </div>
  );
}

function Home() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0a",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          paddingTop: 64,
          paddingLeft: 16,
          paddingRight: 16,
        }}
      >
        <h1 style={{ margin: 0 }}>Home</h1>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 280 }}>
          <Link to="/" style={btn}>Home page</Link>
          <Link to="/supercharts" style={btn}>Supercharts</Link>
          <Link to="/news" style={btn}>News</Link>
          <Link to="/algorithm" style={btn}>Algorithm</Link>
          <Link to="/dashboard" style={btn}>Dashboard</Link>
          {/* NEW */}
          <Link to="/blog" style={btn}>Blog</Link>
          <Link to="/journal" style={btn}>Journal</Link>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <>
      <TopRightHome />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/supercharts" element={<ChartsPage />} />
        <Route path="/news" element={<News />} />
        <Route path="/algorithm" element={<Algorithm />} />
        <Route path="/dashboard" element={<Dashboard />} />
        {/* NEW ROUTES */}
        <Route path="/blog" element={<Blog />} />
        <Route path="/journal" element={<Journal />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}