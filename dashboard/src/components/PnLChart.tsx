import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import type { HourlyRow } from "../api.ts";

interface Props { data: HourlyRow[] }

const FULL_HOURS = Array.from({ length: 24 }, (_, i) => i);

function pad(n: number) { return String(n).padStart(2, "0") + ":00"; }

export function PnLChart({ data }: Props) {
  const byHour = Object.fromEntries(data.map(r => [r.hour, r]));
  const chartData = FULL_HOURS.map(h => ({
    hour: pad(h),
    profit: byHour[h]?.totalProfit ?? null,
    trades: byHour[h]?.tradeCount ?? 0,
  }));

  return (
    <div className="card" style={{ padding: "18px 22px" }}>
      <p className="section-title">P&L by Hour (last 7 days)</p>
      {data.length === 0 ? (
        <div className="empty">No trade data yet — run a scan first</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ececec" />
            <XAxis
              dataKey="hour"
              tick={{ fontSize: 11, fill: "#bcbcbc" }}
              tickLine={false}
              interval={3}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#bcbcbc" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => `$${v}`}
            />
            <Tooltip
              formatter={(v: number) => [`$${v?.toFixed(2)}`, "Profit"]}
              contentStyle={{
                background: "#fff",
                border: "1px solid #bcbcbc",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <ReferenceLine y={0} stroke="#bcbcbc" strokeDasharray="4 2" />
            <Line
              type="monotone"
              dataKey="profit"
              stroke="var(--color-teal)"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 5, fill: "var(--color-teal)" }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
