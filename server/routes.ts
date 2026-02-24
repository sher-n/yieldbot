import type { Elysia } from "elysia";
import { query, queryOne } from "./db.js";

// ─── Route Registration ───────────────────────────────────────────────────────

export function registerRoutes(app: Elysia) {

  // ── Summary ──────────────────────────────────────────────────────────────────
  app.get("/api/summary", () => {
    const since = Date.now() - 24 * 60 * 60 * 1000;

    const row = queryOne<{
      tradeCount: number; totalProfitUsd: number;
      successCount: number; avgProfitUsd: number;
    }>(`
      SELECT
        COUNT(*)                                AS tradeCount,
        COALESCE(SUM(actual_profit_usd), 0)     AS totalProfitUsd,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successCount,
        COALESCE(AVG(actual_profit_usd), 0)     AS avgProfitUsd
      FROM trade_results
      WHERE executed_at >= ?
    `, [since]);

    const risk = queryOne<{
      availableCapitalUsd: number; totalValueUsd: number; riskLevel: string;
    }>(`
      SELECT
        available_capital_usd AS availableCapitalUsd,
        total_value_usd       AS totalValueUsd,
        risk_level            AS riskLevel
      FROM risk_snapshots
      ORDER BY reported_at DESC
      LIMIT 1
    `);

    const tradeCount   = row?.tradeCount   ?? 0;
    const successCount = row?.successCount ?? 0;

    return {
      totalProfitUsd:      Math.round((row?.totalProfitUsd ?? 0) * 100) / 100,
      tradeCount,
      successCount,
      winRate:             tradeCount > 0 ? Math.round((successCount / tradeCount) * 1000) / 10 : 0,
      avgProfitUsd:        Math.round((row?.avgProfitUsd ?? 0) * 100) / 100,
      availableCapitalUsd: risk?.availableCapitalUsd ?? 100000,
      totalValueUsd:       risk?.totalValueUsd       ?? 100000,
      riskLevel:           risk?.riskLevel           ?? "low",
    };
  });

  // ── Hourly Performance ────────────────────────────────────────────────────────
  app.get("/api/hourly", () => {
    return query(`
      SELECT
        CAST(strftime('%H', executed_at / 1000, 'unixepoch') AS INTEGER) AS hour,
        COUNT(*)                                AS tradeCount,
        COALESCE(SUM(actual_profit_usd), 0)    AS totalProfit,
        COALESCE(AVG(actual_profit_usd), 0)    AS avgProfit
      FROM trade_results
      WHERE executed_at >= ?
      GROUP BY hour
      ORDER BY hour ASC
    `, [Date.now() - 7 * 24 * 60 * 60 * 1000]);
  });

  // ── Exchange Pairs ────────────────────────────────────────────────────────────
  app.get("/api/exchange-pairs", () => {
    return query(`
      SELECT
        buy_exchange              AS buyExchange,
        sell_exchange             AS sellExchange,
        COUNT(*)                  AS tradeCount,
        ROUND(AVG(net_profit_pct), 4) AS avgNetProfitPct
      FROM opportunities
      WHERE viable = 1
      GROUP BY buy_exchange, sell_exchange
      ORDER BY avgNetProfitPct DESC
      LIMIT 10
    `);
  });

  // ── Slippage Accuracy ─────────────────────────────────────────────────────────
  app.get("/api/slippage", () => {
    return query(`
      SELECT
        o.exchange                                 AS exchange,
        ROUND(AVG(tr.slippage_error_pct), 4)       AS avgSlippageError,
        COUNT(*)                                   AS sampleCount
      FROM trade_results tr
      JOIN orders o ON o.id = tr.buy_order_id OR o.id = tr.sell_order_id
      WHERE tr.slippage_error_pct IS NOT NULL
      GROUP BY o.exchange
      ORDER BY ABS(AVG(tr.slippage_error_pct)) DESC
    `);
  });

  // ── Risk ──────────────────────────────────────────────────────────────────────
  app.get("/api/risk", () => {
    const snapSQL = `
      SELECT
        id,
        risk_level            AS riskLevel,
        total_value_usd       AS totalValueUsd,
        available_capital_usd AS availableCapitalUsd,
        daily_pnl_usd         AS dailyPnlUsd,
        daily_pnl_pct         AS dailyPnlPct,
        max_drawdown_pct      AS maxDrawdownPct,
        win_rate              AS winRate,
        trade_count           AS tradeCount,
        alerts_json           AS alertsJson,
        reported_at           AS reportedAt
      FROM risk_snapshots
      ORDER BY reported_at DESC
    `;
    const latest  = queryOne<{ alertsJson: string } & Record<string, unknown>>(snapSQL + " LIMIT 1");
    const history = query<{ alertsJson: string } & Record<string, unknown>>(snapSQL + " LIMIT 20");

    const parse = (r: { alertsJson: string } & Record<string, unknown>) =>
      ({ ...r, alerts: JSON.parse((r.alertsJson as string) ?? "[]") });

    return {
      latest:  latest  ? parse(latest)       : null,
      history: history.map(parse),
    };
  });

  // ── Spreads ───────────────────────────────────────────────────────────────────
  app.get("/api/spreads", () => {
    return query(`
      SELECT
        id,
        symbol,
        buy_exchange  AS buyExchange,
        sell_exchange AS sellExchange,
        buy_price     AS buyPrice,
        sell_price    AS sellPrice,
        spread_pct    AS spreadPct,
        scanned_at    AS scannedAt
      FROM spreads
      ORDER BY scanned_at DESC
      LIMIT 50
    `);
  });

  // ── Opportunities ─────────────────────────────────────────────────────────────
  app.get("/api/opportunities", () => {
    return query(`
      SELECT
        id,
        symbol,
        buy_exchange            AS buyExchange,
        sell_exchange           AS sellExchange,
        buy_price               AS buyPrice,
        sell_price              AS sellPrice,
        spread_pct              AS spreadPct,
        net_profit_pct          AS netProfitPct,
        estimated_profit_usd    AS estimatedProfitUsd,
        required_capital_usd    AS requiredCapitalUsd,
        viable,
        reason,
        analyzed_at             AS analyzedAt
      FROM opportunities
      ORDER BY analyzed_at DESC
      LIMIT 50
    `);
  });

  // ── Trades ────────────────────────────────────────────────────────────────────
  app.get("/api/trades", () => {
    return query(`
      SELECT
        id,
        opportunity_id      AS opportunityId,
        buy_order_id        AS buyOrderId,
        sell_order_id       AS sellOrderId,
        estimated_profit_usd AS estimatedProfitUsd,
        actual_profit_usd   AS actualProfitUsd,
        actual_profit_pct   AS actualProfitPct,
        slippage_error_pct  AS slippageErrorPct,
        status,
        executed_at         AS executedAt
      FROM trade_results
      ORDER BY executed_at DESC
      LIMIT 50
    `);
  });

  // ── Price Ticks ───────────────────────────────────────────────────────────────
  app.get("/api/price-ticks", () => {
    return query(`
      SELECT pt.exchange, pt.symbol, pt.bid, pt.ask, pt.last,
             pt.volume_24h AS volume24h,
             pt.scanned_at AS scanned_at
      FROM price_ticks pt
      INNER JOIN (
        SELECT exchange, symbol, MAX(scanned_at) AS max_at
        FROM price_ticks
        GROUP BY exchange, symbol
      ) latest ON pt.exchange = latest.exchange
              AND pt.symbol   = latest.symbol
              AND pt.scanned_at = latest.max_at
      ORDER BY pt.symbol, pt.exchange
    `);
  });

  // ── Run Scan ──────────────────────────────────────────────────────────────────
  app.post("/api/run-scan", () => {
    try {
      Bun.spawn(["npm", "start"], {
        cwd: process.cwd(),
        stdio: ["ignore", "ignore", "ignore"],
        env: { ...process.env } as Record<string, string>,
      });
      return { status: "started", message: "Scan started in background" };
    } catch (err) {
      return new Response(
        JSON.stringify({ status: "error", message: String(err) }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  });

  return app;
}
