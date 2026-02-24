import type { RiskData } from "../api.ts";

interface Props { data: RiskData | null }

const LEVEL_COLOR: Record<string, string> = {
  low:      "#2e7d32",
  medium:   "#f57f17",
  high:     "#e65100",
  critical: "#c62828",
};

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: color ?? "var(--color-dark)" }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--color-muted)", marginTop: 2 }}>{label}</div>
    </div>
  );
}

export function RiskMonitor({ data }: Props) {
  const latest = data?.latest;
  const level = (latest?.riskLevel ?? "low").toLowerCase();
  const dot = LEVEL_COLOR[level] ?? "#888";
  const dailyPnl = latest?.dailyPnlUsd ?? 0;
  const drawdown = latest?.maxDrawdownPct ?? 0;
  const winRate  = latest?.winRate ?? 0;
  const alerts   = latest?.alerts ?? [];

  return (
    <div className="card" style={{ padding: "18px 22px" }}>
      <p className="section-title">Risk Monitor</p>

      {/* Level + stats row */}
      <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 16px",
          background: `${dot}18`,
          border: `1.5px solid ${dot}`,
          borderRadius: 99,
          fontWeight: 800,
          fontSize: 13,
          color: dot,
          textTransform: "uppercase",
          letterSpacing: ".05em",
        }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: dot }} />
          {level} risk
        </div>
        <Stat label="Daily P&L" value={`${dailyPnl >= 0 ? "+" : ""}$${dailyPnl.toFixed(2)}`}
          color={dailyPnl >= 0 ? "var(--color-teal)" : "var(--color-negative)"}
        />
        <Stat label="Max Drawdown" value={`${drawdown.toFixed(2)}%`}
          color={drawdown > 3 ? "var(--color-negative)" : "var(--color-dark)"}
        />
        <Stat label="Win Rate" value={`${winRate.toFixed(1)}%`} />
      </div>

      {/* Alerts */}
      {alerts.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {alerts.map((a, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 8,
              fontSize: 12,
              color: level === "critical" || level === "high" ? "var(--color-negative)" : "var(--color-text)",
              background: "#fafafa",
              border: "1px solid var(--color-border)",
              borderRadius: 6,
              padding: "6px 10px",
            }}>
              <span>⚠</span> {a}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "var(--color-muted)" }}>
          {latest ? "✓ No active alerts" : "No risk data yet — run a scan first"}
        </div>
      )}
    </div>
  );
}
