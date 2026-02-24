import { useEffect, useState, useCallback, useRef } from "react";
import { api, type Summary, type HourlyRow, type ExchangePair, type SlippageRow, type RiskData, type Spread, type Opportunity, type Trade } from "./api.ts";
import { Header } from "./components/Header.tsx";
import { SummaryCards } from "./components/SummaryCards.tsx";
import { PnLChart } from "./components/PnLChart.tsx";
import { ExchangeLeaderboard } from "./components/ExchangeLeaderboard.tsx";
import { RiskMonitor } from "./components/RiskMonitor.tsx";
import { SlippageTracker } from "./components/SlippageTracker.tsx";
import { LiveSpreads } from "./components/LiveSpreads.tsx";
import { OpportunityTable } from "./components/OpportunityTable.tsx";
import { TradeHistory } from "./components/TradeHistory.tsx";

type Tab = "spreads" | "opportunities" | "trades";

interface AppData {
  summary:    Summary | null;
  hourly:     HourlyRow[];
  pairs:      ExchangePair[];
  slippage:   SlippageRow[];
  risk:       RiskData | null;
  spreads:    Spread[];
  opportunities: Opportunity[];
  trades:     Trade[];
}

const EMPTY: AppData = {
  summary: null, hourly: [], pairs: [], slippage: [],
  risk: null, spreads: [], opportunities: [], trades: [],
};

export default function App() {
  const [data, setData] = useState<AppData>(EMPTY);
  const [tab, setTab] = useState<Tab>("spreads");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>("—");
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [summary, hourly, pairs, slippage, risk, spreads, opportunities, trades] = await Promise.allSettled([
        api.summary(),
        api.hourly(),
        api.exchangePairs(),
        api.slippage(),
        api.risk(),
        api.spreads(),
        api.opportunities(),
        api.trades(),
      ]);

      setData({
        summary:       summary.status       === "fulfilled" ? summary.value       : null,
        hourly:        hourly.status        === "fulfilled" ? hourly.value        : [],
        pairs:         pairs.status         === "fulfilled" ? pairs.value         : [],
        slippage:      slippage.status      === "fulfilled" ? slippage.value      : [],
        risk:          risk.status          === "fulfilled" ? risk.value          : null,
        spreads:       spreads.status       === "fulfilled" ? spreads.value       : [],
        opportunities: opportunities.status === "fulfilled" ? opportunities.value : [],
        trades:        trades.status        === "fulfilled" ? trades.value        : [],
      });

      setLastUpdated(new Date().toLocaleTimeString());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(fetchAll, 5_000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, fetchAll]);

  const riskLevel = data.summary?.riskLevel ?? data.risk?.latest?.riskLevel ?? "low";

  const TAB_LABELS: { key: Tab; label: string; count: number }[] = [
    { key: "spreads",       label: "Live Spreads",    count: data.spreads.length },
    { key: "opportunities", label: "Opportunities",   count: data.opportunities.length },
    { key: "trades",        label: "Trade History",   count: data.trades.length },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)" }}>
      <Header
        riskLevel={riskLevel}
        autoRefresh={autoRefresh}
        onToggleRefresh={() => setAutoRefresh(v => !v)}
      />

      <main style={{ maxWidth: 1400, margin: "0 auto", padding: "20px 20px 40px" }}>

        {/* Error Banner */}
        {error && (
          <div style={{
            background: "#fce4ec", border: "1px solid #ef9a9a",
            borderRadius: "var(--radius)", padding: "10px 16px",
            marginBottom: 16, fontSize: 13, color: "#c62828",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            ⚠ API error: {error} — is the Elysia server running? (<code>npm run dev:api</code>)
          </div>
        )}

        {/* Summary Cards */}
        <section style={{ marginBottom: 20 }}>
          <SummaryCards data={data.summary} />
        </section>

        {/* Charts Row */}
        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <PnLChart data={data.hourly} />
          <ExchangeLeaderboard data={data.pairs} />
        </section>

        {/* Risk + Slippage Row */}
        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <RiskMonitor data={data.risk} />
          <SlippageTracker data={data.slippage} />
        </section>

        {/* Bottom Tab Panel */}
        <section className="card" style={{ overflow: "hidden" }}>
          {/* Tab Bar */}
          <div style={{
            display: "flex", borderBottom: "1px solid var(--color-border)",
            padding: "0 6px",
            background: "var(--color-card)",
          }}>
            {TAB_LABELS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  background: "none",
                  color: tab === t.key ? "var(--color-teal)" : "var(--color-muted)",
                  borderBottom: tab === t.key ? "2px solid var(--color-teal)" : "2px solid transparent",
                  borderRadius: 0,
                  padding: "12px 18px",
                  fontWeight: tab === t.key ? 700 : 500,
                  fontSize: 13,
                  transform: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {t.label}
                {t.count > 0 && (
                  <span style={{
                    background: tab === t.key ? "var(--color-teal)" : "var(--color-border)",
                    color: tab === t.key ? "#fff" : "var(--color-dark)",
                    borderRadius: 99,
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "1px 6px",
                    minWidth: 18,
                    textAlign: "center",
                  }}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <div style={{ alignSelf: "center", fontSize: 11, color: "var(--color-muted)", paddingRight: 12 }}>
              Updated {lastUpdated}
            </div>
          </div>

          {/* Tab Content */}
          <div style={{ padding: "0" }}>
            {tab === "spreads"       && <LiveSpreads data={data.spreads} />}
            {tab === "opportunities" && <OpportunityTable data={data.opportunities} />}
            {tab === "trades"        && <TradeHistory data={data.trades} />}
          </div>
        </section>
      </main>
    </div>
  );
}
