// src/Blog.tsx
import { useEffect, useLayoutEffect, useState } from "react";
import { Link } from "react-router-dom";

type Comment = {
  id: string;
  text: string;
  ts: number;
  up: number;
  down: number;
};

type Reaction = "up" | "down";
type ReactionMap = Record<string, Reaction | undefined>;

const COMMENTS_KEY = "blogComments:v3";       // bump to v3 to ensure clean counts
const REACTIONS_KEY = "blogReactions:v1";     // per-visitor reaction map

const btn: React.CSSProperties = {
  display: "inline-block",
  padding: "10px 14px",
  background: "#000",
  color: "#fff",
  border: "1px solid #333",
  borderRadius: 10,
  cursor: "pointer",
  textDecoration: "none",
};

// Active styles for voted buttons
const activeUp: React.CSSProperties = { borderColor: "rgba(46, 204, 113, 0.9)", boxShadow: "0 0 8px rgba(46,204,113,.35) inset" };
const activeDown: React.CSSProperties = { borderColor: "rgba(231, 76, 60, 0.9)",  boxShadow: "0 0 8px rgba(231,76,60,.35) inset" };

export default function Blog() {
  const [text, setText] = useState("");
  const [comments, setComments] = useState<Comment[] | null>(null); // null until loaded
  const [myReactions, setMyReactions] = useState<ReactionMap>({});

  // transient per-comment flash: "up" | "down" | undefined
  const [flash, setFlash] = useState<Record<string, Reaction | undefined>>({});

  // Inject keyframes once
  useEffect(() => {
    const style = document.createElement("style");
    style.dataset.blogReactions = "1";
    style.textContent = `
      @keyframes glow-up {
        0%   { box-shadow: 0 0 0 0 rgba(46, 204, 113, 0.0), inset 0 0 0 0 rgba(46, 204, 113, 0.0); }
        50%  { box-shadow: 0 0 16px 2px rgba(46, 204, 113, 0.6), inset 0 0 12px 1px rgba(46, 204, 113, 0.4); }
        100% { box-shadow: 0 0 0 0 rgba(46, 204, 113, 0.0), inset 0 0 0 0 rgba(46, 204, 113, 0.0); }
      }
      @keyframes glow-down {
        0%   { box-shadow: 0 0 0 0 rgba(231, 76, 60, 0.0), inset 0 0 0 0 rgba(231, 76, 60, 0.0); }
        50%  { box-shadow: 0 0 16px 2px rgba(231, 76, 60, 0.6), inset 0 0 12px 1px rgba(231, 76, 60, 0.4); }
        100% { box-shadow: 0 0 0 0 rgba(231, 76, 60, 0.0), inset 0 0 0 0 rgba(231, 76, 60, 0.0); }
      }
      .card-glow-up   { animation: glow-up   480ms ease-out; }
      .card-glow-down { animation: glow-down 480ms ease-out; }
    `;
    document.head.appendChild(style);
    return () => { document.head.querySelector('style[data-blog-reactions="1"]')?.remove(); };
  }, []);

  // Load comments + myReactions
  useLayoutEffect(() => {
    try {
      // comments
      const raw = localStorage.getItem(COMMENTS_KEY);
      if (raw) {
        setComments(JSON.parse(raw) as Comment[]);
      } else {
        // attempt migrate from older versions (no votes or v2 counts)
        const v2 = localStorage.getItem("blogComments:v2");
        const v1 = localStorage.getItem("blogComments:v1");
        if (v2 || v1) {
          const src = JSON.parse(v2 ?? v1!);
          const migrated: Comment[] = (src as any[]).map((c) => ({
            id: c.id,
            text: c.text,
            ts: c.ts,
            up: typeof c.up === "number" ? c.up : 0,
            down: typeof c.down === "number" ? c.down : 0,
          }));
          setComments(migrated);
        } else {
          setComments([]);
        }
      }

      // reactions
      const rraw = localStorage.getItem(REACTIONS_KEY);
      if (rraw) setMyReactions(JSON.parse(rraw) as ReactionMap);
    } catch {
      setComments([]);
      setMyReactions({});
    }
  }, []);

  // Persist comments
  useEffect(() => {
    if (!comments) return;
    try { localStorage.setItem(COMMENTS_KEY, JSON.stringify(comments)); } catch {}
  }, [comments]);

  // Persist reactions
  useEffect(() => {
    try { localStorage.setItem(REACTIONS_KEY, JSON.stringify(myReactions)); } catch {}
  }, [myReactions]);

  // Cross-tab sync for both keys
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === COMMENTS_KEY && e.newValue) {
        try { setComments(JSON.parse(e.newValue)); } catch {}
      }
      if (e.key === REACTIONS_KEY && e.newValue) {
        try { setMyReactions(JSON.parse(e.newValue)); } catch {}
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function addComment() {
    const t = text.trim();
    if (!t || !comments) return;
    setComments([{ id: crypto.randomUUID(), text: t, ts: Date.now(), up: 0, down: 0 }, ...comments]);
    setText("");
  }

  function removeComment(id: string) {
    if (!comments) return;
    setComments(comments.filter(c => c.id !== id));
    setFlash(prev => {
      const copy = { ...prev }; delete copy[id]; return copy;
    });
    // also remove my reaction entry for that comment
    setMyReactions(prev => {
      const copy = { ...prev }; delete copy[id]; return copy;
    });
  }

  // Core voting logic (toggle)
  function toggleVote(id: string, dir: Reaction) {
    if (!comments) return;

    const prevReaction = myReactions[id]; // "up" | "down" | undefined
    let nextReaction: Reaction | undefined = dir;

    // If clicking same reaction again → remove reaction
    if (prevReaction === dir) {
      nextReaction = undefined;
    }

    setComments(comments.map(c => {
      if (c.id !== id) return c;
      let up = c.up ?? 0;
      let down = c.down ?? 0;

      // remove previous reaction effect
      if (prevReaction === "up")   up = Math.max(0, up - 1);
      if (prevReaction === "down") down = Math.max(0, down - 1);

      // apply new reaction effect (if any)
      if (nextReaction === "up")   up += 1;
      if (nextReaction === "down") down += 1;

      return { ...c, up, down };
    }));

    setMyReactions(prev => ({ ...prev, [id]: nextReaction }));

    // trigger glow only when applying a reaction (not when removing)
    if (nextReaction) {
      setFlash(prev => ({ ...prev, [id]: nextReaction }));
      window.setTimeout(() => {
        setFlash(prev => ({ ...prev, [id]: undefined }));
      }, 500);
    }
  }

  if (comments === null) {
    return <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", padding: 24 }}>Loading…</div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff" }}>
      <div style={{ position: "fixed", top: 12, right: 12 }}>
        <Link to="/" style={{ ...btn, padding: "8px 12px" }}>Home</Link>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "80px 16px 24px" }}>
        <h1 style={{ marginTop: 0 }}>Blog</h1>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginTop: 24 }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a comment…"
            rows={4}
            style={{
              width: "100%",
              maxWidth: 640,
              background: "#111",
              color: "#fff",
              border: "1px solid #333",
              borderRadius: 10,
              padding: 12,
              resize: "vertical",
            }}
          />
          <button onClick={addComment} style={btn}>Submit</button>
        </div>

        <ul style={{ listStyle: "none", padding: 0, marginTop: 24, display: "grid", gap: 12 }}>
          {comments.length === 0 && <li style={{ opacity: 0.7 }}>No comments yet — be the first!</li>}
          {comments.map((c) => {
            const glowClass =
              flash[c.id] === "up" ? "card-glow-up" :
              flash[c.id] === "down" ? "card-glow-down" :
              "";

            const mine = myReactions[c.id]; // "up" | "down" | undefined

            return (
              <li key={c.id}>
                <div
                  className={glowClass}
                  style={{
                    background: "#141414",
                    border: "1px solid #262626",
                    borderRadius: 12,
                    padding: 12,
                    display: "grid",
                    gap: 8,
                    transition: "box-shadow 150ms ease, border-color 150ms ease",
                  }}
                >
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {new Date(c.ts).toLocaleString()}
                  </div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{c.text}</div>

                  {/* actions */}
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                    <button
                      aria-label="Thumbs up"
                      onClick={() => toggleVote(c.id, "up")}
                      style={{ ...btn, padding: "6px 10px", ...(mine === "up" ? activeUp : {}) }}
                      title="Thumbs up"
                    >
                      👍 {c.up}
                    </button>
                    <button
                      aria-label="Thumbs down"
                      onClick={() => toggleVote(c.id, "down")}
                      style={{ ...btn, padding: "6px 10px", ...(mine === "down" ? activeDown : {}) }}
                      title="Thumbs down"
                    >
                      👎 {c.down}
                    </button>
                    <div style={{ flex: 1 }} />
                    <button onClick={() => removeComment(c.id)} style={{ ...btn, padding: "6px 10px" }}>
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}