import { useState } from "react";
import { api } from "../api.ts";

interface Props {
  riskLevel: string;
  autoRefresh: boolean;
  onToggleRefresh: () => void;
}

const riskColors: Record<string, string> = {
  low:      "#3a3",
  medium:   "#f90",
  high:     "#e63",
  critical: "#c22",
};

export function Header({ riskLevel, autoRefresh, onToggleRefresh }: Props) {
  const [scanning, setScanning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleScan() {
    setScanning(true);
    setMsg(null);
    try {
      const res = await api.runScan();
      setMsg(res.message);
    } catch {
      setMsg("Failed to start scan");
    } finally {
      setTimeout(() => {
        setScanning(false);
        setMsg(null);
      }, 30_000);
    }
  }

  const dot = riskColors[riskLevel.toLowerCase()] ?? "#888";

  return (
    <header style={{
      background: "var(--color-dark)",
      color: "#fff",
      padding: "0 24px",
      height: 56,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
      boxShadow: "0 2px 8px rgba(0,0,0,.25)",
      position: "sticky",
      top: 0,
      zIndex: 100,
    }}>
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 800, fontSize: 18, letterSpacing: "-.01em" }}>
        <span style={{ fontSize: 22 }}>⚡</span>
        <span style={{ color: "var(--color-orange)" }}>Yield</span>
        <span>Bot</span>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {msg && (
          <span style={{ fontSize: 12, opacity: .8, color: "var(--color-orange)" }}>{msg}</span>
        )}

        {/* Risk badge */}
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "rgba(255,255,255,.1)",
          border: "1px solid rgba(255,255,255,.15)",
          borderRadius: 99,
          padding: "4px 12px",
          fontSize: 12,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: ".05em",
        }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, display: "inline-block" }} />
          {riskLevel} risk
        </div>

        {/* Auto-refresh toggle */}
        <button className="btn-secondary" onClick={onToggleRefresh} style={{ fontSize: 12 }}>
          {autoRefresh ? "⟳ 5s" : "⟳ paused"}
        </button>

        {/* Run Scan */}
        <button
          className="btn-primary"
          onClick={handleScan}
          disabled={scanning}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          {scanning ? (
            <><span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span> Scanning…</>
          ) : (
            <>▶ Run Scan</>
          )}
        </button>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </header>
  );
}
