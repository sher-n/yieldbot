import type { SlippageRow } from "../api.ts";

interface Props { data: SlippageRow[] }

function quality(err: number): { label: string; color: string } {
  const abs = Math.abs(err);
  if (abs < 0.05) return { label: "Accurate", color: "var(--color-teal)" };
  if (abs < 0.15) return { label: "Acceptable", color: "var(--color-orange)" };
  return { label: "Recalibrate", color: "var(--color-negative)" };
}

export function SlippageTracker({ data }: Props) {
  return (
    <div className="card" style={{ padding: "18px 22px" }}>
      <p className="section-title">Slippage Accuracy by Exchange</p>
      {data.length === 0 ? (
        <div className="empty">No trade data yet</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Exchange</th>
                <th style={{ textAlign: "right" }}>Avg Error</th>
                <th style={{ textAlign: "right" }}>Samples</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map(row => {
                const q = quality(row.avgSlippageError ?? 0);
                return (
                  <tr key={row.exchange}>
                    <td style={{ fontWeight: 600, textTransform: "capitalize" }}>{row.exchange}</td>
                    <td style={{
                      textAlign: "right",
                      color: (row.avgSlippageError ?? 0) > 0 ? "var(--color-negative)" : "var(--color-teal)",
                      fontWeight: 600,
                    }}>
                      {(row.avgSlippageError ?? 0) >= 0 ? "+" : ""}
                      {((row.avgSlippageError ?? 0) * 100).toFixed(3)}%
                    </td>
                    <td style={{ textAlign: "right", color: "var(--color-muted)" }}>{row.sampleCount}</td>
                    <td>
                      <span style={{
                        fontSize: 11, fontWeight: 700,
                        color: q.color,
                        background: `${q.color}18`,
                        padding: "2px 8px",
                        borderRadius: 99,
                      }}>
                        {q.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
