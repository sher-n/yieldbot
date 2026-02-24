import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import type { ExchangePair } from "../api.ts";

interface Props { data: ExchangePair[] }

export function ExchangeLeaderboard({ data }: Props) {
  const chartData = data.slice(0, 8).map(p => ({
    pair: `${p.buyExchange.slice(0,3).toUpperCase()}→${p.sellExchange.slice(0,3).toUpperCase()}`,
    profit: Math.round(p.avgNetProfitPct * 10000) / 100,
    trades: p.tradeCount,
    raw: p,
  }));

  return (
    <div className="card" style={{ padding: "18px 22px" }}>
      <p className="section-title">Exchange Pair Leaderboard</p>
      {data.length === 0 ? (
        <div className="empty">No opportunity data yet</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ececec" vertical={false} />
            <XAxis
              dataKey="pair"
              tick={{ fontSize: 11, fill: "#bcbcbc" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#bcbcbc" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => `${v}%`}
            />
            <Tooltip
              formatter={(v: number, _: string, props: { payload?: { trades: number } }) => [
                [`${v.toFixed(3)}%`, "Avg Net Profit"],
                [`${props.payload?.trades ?? 0}`, "Trades"],
              ].flat()}
              contentStyle={{
                background: "#fff",
                border: "1px solid #bcbcbc",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
              {chartData.map((_, i) => (
                <Cell
                  key={i}
                  fill={i === 0 ? "var(--color-orange)" : i === 1 ? "#ffb84d" : "#ffd280"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
