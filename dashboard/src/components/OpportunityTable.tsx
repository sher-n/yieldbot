import type { Opportunity } from "../api.ts";

interface Props { data: Opportunity[] }

function fmtTime(ms: number) {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function OpportunityTable({ data }: Props) {
  return (
    <>
      {data.length === 0 ? (
        <div className="empty">No opportunities analyzed yet</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Route</th>
                <th style={{ textAlign: "right" }}>Spread %</th>
                <th style={{ textAlign: "right" }}>Net Profit %</th>
                <th style={{ textAlign: "right" }}>Est. Profit</th>
                <th style={{ textAlign: "right" }}>Capital</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 30).map(row => (
                <tr key={row.id}>
                  <td style={{ fontWeight: 700 }}>{row.symbol}</td>
                  <td style={{ fontSize: 12, color: "var(--color-muted)" }}>
                    {row.buyExchange} → {row.sellExchange}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "monospace" }}>
                    {row.spreadPct.toFixed(3)}%
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <span className={row.netProfitPct > 0 ? "positive" : "negative"}>
                      {row.netProfitPct >= 0 ? "+" : ""}{row.netProfitPct.toFixed(3)}%
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <span className={row.estimatedProfitUsd > 0 ? "positive" : "negative"}>
                      ${row.estimatedProfitUsd.toFixed(2)}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", color: "var(--color-muted)" }}>
                    ${(row.requiredCapitalUsd / 1000).toFixed(1)}k
                  </td>
                  <td>
                    <span className={`badge ${row.viable ? "badge-viable" : "badge-blocked"}`}>
                      {row.viable ? "✓ viable" : "✗ blocked"}
                    </span>
                  </td>
                  <td style={{ color: "var(--color-muted)", fontSize: 12 }}>{fmtTime(row.analyzedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
