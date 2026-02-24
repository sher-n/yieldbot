import type { Summary } from "../api.ts";

interface Props {
  data: Summary | null;
}

function Card({ label, value, sub, icon, accent }: {
  label: string;
  value: string;
  sub?: string;
  icon: string;
  accent?: boolean;
}) {
  return (
    <div className="card" style={{ padding: "18px 22px", flex: 1, minWidth: 160 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span style={{ fontSize: 22 }}>{icon}</span>
        <span style={{
          fontSize: 11, fontWeight: 700, textTransform: "uppercase",
          letterSpacing: ".05em", color: "var(--color-muted)"
        }}>{label}</span>
      </div>
      <div style={{
        marginTop: 12,
        fontSize: 26,
        fontWeight: 800,
        color: accent ? "var(--color-orange)" : "var(--color-dark)",
        letterSpacing: "-.02em",
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: "var(--color-muted)", marginTop: 4 }}>{sub}</div>
      )}
    </div>
  );
}

function fmt(n: number, digits = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function SummaryCards({ data }: Props) {
  const pnl = data?.totalProfitUsd ?? 0;
  const winRate = data?.winRate ?? 0;
  const trades = data?.tradeCount ?? 0;
  const capital = data?.availableCapitalUsd ?? 0;

  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
      <Card
        icon="📈"
        label="Total P&L (24h)"
        value={`${pnl >= 0 ? "+" : ""}$${fmt(pnl)}`}
        sub={`avg $${fmt(data?.avgProfitUsd ?? 0)} / trade`}
        accent={pnl > 0}
      />
      <Card
        icon="🎯"
        label="Win Rate"
        value={`${fmt(winRate, 1)}%`}
        sub={`${data?.successCount ?? 0} successful trades`}
      />
      <Card
        icon="📊"
        label="Total Trades"
        value={String(trades)}
        sub="last 24 hours"
      />
      <Card
        icon="💰"
        label="Available Capital"
        value={`$${(capital / 1000).toFixed(1)}k`}
        sub={`of $${fmt((data?.totalValueUsd ?? 0) / 1000, 1)}k total`}
      />
    </div>
  );
}
