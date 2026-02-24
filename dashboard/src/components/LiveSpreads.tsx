import type { Spread } from "../api.ts";

interface Props { data: Spread[] }

function fmtTime(ms: number) {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function LiveSpreads({ data }: Props) {
  return (
    <>
      {data.length === 0 ? (
        <div className="empty">No spreads recorded yet — run a scan first</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Buy At</th>
                <th>Sell At</th>
                <th style={{ textAlign: "right" }}>Buy Price</th>
                <th style={{ textAlign: "right" }}>Sell Price</th>
                <th style={{ textAlign: "right" }}>Spread %</th>
                <th>Scanned</th>
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 30).map(row => (
                <tr key={row.id}>
                  <td style={{ fontWeight: 700 }}>{row.symbol}</td>
                  <td style={{ textTransform: "capitalize" }}>{row.buyExchange}</td>
                  <td style={{ textTransform: "capitalize" }}>{row.sellExchange}</td>
                  <td style={{ textAlign: "right", fontFamily: "monospace" }}>
                    ${row.buyPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "monospace" }}>
                    ${row.sellPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <span style={{
                      color: row.spreadPct > 0.5 ? "var(--color-orange)" : "var(--color-text)",
                      fontWeight: row.spreadPct > 0.5 ? 700 : 400,
                    }}>
                      {row.spreadPct.toFixed(3)}%
                    </span>
                  </td>
                  <td style={{ color: "var(--color-muted)", fontSize: 12 }}>{fmtTime(row.scannedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
