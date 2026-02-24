import type { Trade } from "../api.ts";

interface Props { data: Trade[] }

function fmtTime(ms: number) {
  return new Date(ms).toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function TradeHistory({ data }: Props) {
  return (
    <>
      {data.length === 0 ? (
        <div className="empty">No trades executed yet</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Trade ID</th>
                <th style={{ textAlign: "right" }}>Est. Profit</th>
                <th style={{ textAlign: "right" }}>Actual Profit</th>
                <th style={{ textAlign: "right" }}>Actual %</th>
                <th style={{ textAlign: "right" }}>Slip. Error</th>
                <th>Status</th>
                <th>Executed</th>
              </tr>
            </thead>
            <tbody>
              {data.map(row => {
                const diff = row.actualProfitUsd - row.estimatedProfitUsd;
                return (
                  <tr key={row.id}>
                    <td style={{ fontFamily: "monospace", fontSize: 11, color: "var(--color-muted)" }}>
                      {row.opportunityId ?? `#${row.id}`}
                    </td>
                    <td style={{ textAlign: "right", color: "var(--color-muted)" }}>
                      ${row.estimatedProfitUsd.toFixed(2)}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <span className={row.actualProfitUsd >= 0 ? "positive" : "negative"}>
                        {row.actualProfitUsd >= 0 ? "+" : ""}${row.actualProfitUsd.toFixed(2)}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <span className={row.actualProfitPct >= 0 ? "positive" : "negative"}>
                        {row.actualProfitPct >= 0 ? "+" : ""}{row.actualProfitPct.toFixed(3)}%
                      </span>
                    </td>
                    <td style={{ textAlign: "right", fontSize: 12 }}>
                      <span style={{ color: Math.abs(row.slippageErrorPct ?? 0) > 0.1 ? "var(--color-negative)" : "var(--color-muted)" }}>
                        {diff >= 0 ? "+" : ""}${diff.toFixed(2)}
                      </span>
                    </td>
                    <td>
                      <span className={`badge badge-${row.status}`}>{row.status}</span>
                    </td>
                    <td style={{ color: "var(--color-muted)", fontSize: 12 }}>
                      {row.executedAt ? fmtTime(row.executedAt) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
