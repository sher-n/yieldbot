/**
 * Repository — all data access in one place.
 *
 * Split into four sections:
 *   A. Writes  — insert rows from agent tool handlers
 *   B. Reads   — cache lookups to skip redundant API calls
 *   C. Analytics — queries that feed back into agent decision-making
 *   D. Maintenance — pruning, vacuum helpers
 */

import { desc, eq, gte, and, sql, avg, count, sum } from "drizzle-orm";
import { db } from "./index.js";
import {
  priceTicks,
  spreads,
  opportunities,
  orders,
  tradeResults,
  riskSnapshots,
} from "./schema.js";
import type {
  PriceTick,
  ArbitrageSpread,
  ArbitrageOpportunity,
  Order,
  TradeResult,
  RiskReport,
} from "../types.js";

// ==========================================================================
// A. WRITES
// ==========================================================================

/** Bulk-insert price ticks from a full exchange scan. */
export function insertPriceTicks(ticks: PriceTick[]): void {
  if (ticks.length === 0) return;
  db.insert(priceTicks)
    .values(
      ticks.map((t) => ({
        exchange:  t.exchange,
        symbol:    t.symbol,
        bid:       t.bid,
        ask:       t.ask,
        last:      t.last,
        volume24h: t.volume24h,
        scannedAt: t.timestamp,
      }))
    )
    .run();
}

/** Insert a single spread observation. Returns the new row id. */
export function insertSpread(spread: ArbitrageSpread): number {
  const result = db
    .insert(spreads)
    .values({
      symbol:      spread.symbol,
      buyExchange: spread.buyExchange,
      sellExchange:spread.sellExchange,
      buyPrice:    spread.buyPrice,
      sellPrice:   spread.sellPrice,
      spreadPct:   spread.spreadPct,
      scannedAt:   spread.timestamp,
    })
    .returning({ id: spreads.id })
    .get();
  return result!.id;
}

/** Insert bulk spreads and return their ids. */
export function insertSpreads(spreadList: ArbitrageSpread[]): number[] {
  return spreadList.map(insertSpread);
}

/** Insert an analyzed opportunity. spreadId is optional (link to spreads row). */
export function insertOpportunity(
  opp: ArbitrageOpportunity,
  spreadId?: number
): void {
  db.insert(opportunities)
    .values({
      id:                 opp.id,
      spreadId:           spreadId ?? null,
      symbol:             opp.spread.symbol,
      buyExchange:        opp.spread.buyExchange,
      sellExchange:       opp.spread.sellExchange,
      buyPrice:           opp.spread.buyPrice,
      sellPrice:          opp.spread.sellPrice,
      spreadPct:          opp.spread.spreadPct,
      grossProfitPct:     opp.grossProfitPct,
      netProfitPct:       opp.netProfitPct,
      estimatedProfitUsd: opp.estimatedProfitUSD,
      requiredCapitalUsd: opp.requiredCapitalUSD,
      buyFee:             opp.buyFee,
      sellFee:            opp.sellFee,
      slippagePct:        opp.slippagePct,
      viable:             opp.viable,
      reason:             opp.reason ?? null,
      analyzedAt:         Date.now(),
    })
    .onConflictDoNothing()
    .run();
}

/** Insert a placed/filled order. */
export function insertOrder(order: Order, opportunityId?: string): void {
  db.insert(orders)
    .values({
      id:            order.id,
      opportunityId: opportunityId ?? null,
      exchange:      order.exchange,
      symbol:        order.symbol,
      side:          order.side,
      orderType:     order.type,
      amount:        order.amount,
      price:         order.price ?? null,
      status:        order.status,
      filledAmount:  order.filledAmount,
      avgFillPrice:  order.avgFillPrice,
      placedAt:      order.timestamp,
    })
    .onConflictDoUpdate({
      target: orders.id,
      set: {
        status:       order.status,
        filledAmount: order.filledAmount,
        avgFillPrice: order.avgFillPrice,
      },
    })
    .run();
}

/**
 * Insert a completed trade result.
 * slippageErrorPct = actualSlippage - estimatedSlippage; feed this back
 * into the Opportunity Analyzer to calibrate estimates over time.
 */
export function insertTradeResult(
  result: TradeResult,
  estimatedProfitUsd: number,
  estimatedSlippagePct: number
): void {
  const { buyOrder, sellOrder } = result;

  // Compute actual slippage from fill prices
  const actualBuySlippage  = buyOrder.price
    ? Math.abs(buyOrder.avgFillPrice - buyOrder.price)  / buyOrder.price
    : 0;
  const actualSellSlippage = sellOrder.price
    ? Math.abs(sellOrder.avgFillPrice - sellOrder.price) / sellOrder.price
    : 0;
  const actualSlippagePct  = (actualBuySlippage + actualSellSlippage) * 100;
  const slippageErrorPct   = actualSlippagePct - estimatedSlippagePct;

  db.insert(tradeResults)
    .values({
      opportunityId:      result.opportunityId,
      buyOrderId:         result.buyOrder.id,
      sellOrderId:        result.sellOrder.id,
      estimatedProfitUsd,
      actualProfitUsd:    result.actualProfitUSD,
      actualProfitPct:    result.actualProfitPct,
      slippageErrorPct,
      status:             result.status,
      executedAt:         Date.now(),
    })
    .run();
}

/** Snapshot the current risk state after each assessment cycle. */
export function insertRiskSnapshot(report: RiskReport): void {
  db.insert(riskSnapshots)
    .values({
      riskLevel:           report.riskLevel,
      totalValueUsd:       report.portfolio.totalValueUSD,
      availableCapitalUsd: report.portfolio.availableCapitalUSD,
      dailyPnlUsd:         report.portfolio.dailyPnlUSD,
      dailyPnlPct:         report.portfolio.dailyPnlPct,
      maxDrawdownPct:      report.portfolio.maxDrawdownPct,
      winRate:             report.portfolio.winRate,
      tradeCount:          report.portfolio.tradeCount,
      alertsJson:          JSON.stringify(report.alerts),
      reportedAt:          report.timestamp,
    })
    .run();
}

// ==========================================================================
// B. READS — cache lookups
// ==========================================================================

/**
 * Return a cached price tick if one exists within the TTL window.
 * Saves an exchange API call (and potentially a whole Claude invocation)
 * when the scanner runs more frequently than prices change.
 */
export function getRecentTick(
  exchange: string,
  symbol: string,
  ttlMs = 30_000
): typeof priceTicks.$inferSelect | undefined {
  const cutoff = Date.now() - ttlMs;
  return db
    .select()
    .from(priceTicks)
    .where(
      and(
        eq(priceTicks.exchange, exchange),
        eq(priceTicks.symbol, symbol),
        gte(priceTicks.scannedAt, cutoff)
      )
    )
    .orderBy(desc(priceTicks.scannedAt))
    .limit(1)
    .get();
}

/** All recent ticks for a symbol across all exchanges (for spread calc). */
export function getRecentTicksForSymbol(
  symbol: string,
  ttlMs = 30_000
): (typeof priceTicks.$inferSelect)[] {
  const cutoff = Date.now() - ttlMs;
  return db
    .select()
    .from(priceTicks)
    .where(
      and(eq(priceTicks.symbol, symbol), gte(priceTicks.scannedAt, cutoff))
    )
    .orderBy(desc(priceTicks.scannedAt))
    .all();
}

/** Fetch the N most recent trade results for the risk manager. */
export function getRecentTradeResults(
  limit = 50
): (typeof tradeResults.$inferSelect)[] {
  return db
    .select()
    .from(tradeResults)
    .orderBy(desc(tradeResults.executedAt))
    .limit(limit)
    .all();
}

/** Fetch the latest risk snapshot. */
export function getLatestRiskSnapshot():
  | (typeof riskSnapshots.$inferSelect)
  | undefined {
  return db
    .select()
    .from(riskSnapshots)
    .orderBy(desc(riskSnapshots.reportedAt))
    .limit(1)
    .get();
}

// ==========================================================================
// C. ANALYTICS — feed back into agent prompts to improve decisions
// ==========================================================================

/**
 * Top exchange pairs ranked by average net profit %.
 * Feed this into the Opportunity Analyzer to bias toward historically
 * productive pairs.
 *
 * Returns: [{ buyExchange, sellExchange, avgNetProfitPct, tradeCount }]
 */
export function getTopExchangePairs(limit = 10): {
  buyExchange:     string;
  sellExchange:    string;
  avgNetProfitPct: number;
  tradeCount:      number;
}[] {
  return db
    .select({
      buyExchange:     opportunities.buyExchange,
      sellExchange:    opportunities.sellExchange,
      avgNetProfitPct: avg(opportunities.netProfitPct).mapWith(Number),
      tradeCount:      count(opportunities.id),
    })
    .from(opportunities)
    .where(eq(opportunities.viable, true))
    .groupBy(opportunities.buyExchange, opportunities.sellExchange)
    .orderBy(desc(avg(opportunities.netProfitPct)))
    .limit(limit)
    .all() as {
      buyExchange: string;
      sellExchange: string;
      avgNetProfitPct: number;
      tradeCount: number;
    }[];
}

/**
 * Win rate and avg profit by symbol.
 * Tells the scanner which pairs to prioritise scanning.
 */
export function getSymbolStats(): {
  symbol:        string;
  winRate:       number;
  avgProfitUsd:  number;
  tradeCount:    number;
}[] {
  const rows = db
    .select({
      symbol:       tradeResults.opportunityId,  // joined via opportunities later
      tradeCount:   count(tradeResults.id),
      totalProfit:  sum(tradeResults.actualProfitUsd),
    })
    .from(tradeResults)
    .groupBy(tradeResults.opportunityId)
    .all();

  // For now use a simpler raw query via the underlying SQL
  const raw = db.all(
    sql`
      SELECT
        o.symbol,
        COUNT(t.id)                                            AS trade_count,
        ROUND(AVG(t.actual_profit_usd), 4)                    AS avg_profit_usd,
        ROUND(
          SUM(CASE WHEN t.status = 'success' THEN 1.0 ELSE 0 END)
          / COUNT(t.id), 4
        )                                                      AS win_rate
      FROM trade_results t
      JOIN opportunities o ON t.opportunity_id = o.id
      GROUP BY o.symbol
      ORDER BY avg_profit_usd DESC
    `
  ) as { symbol: string; trade_count: number; avg_profit_usd: number; win_rate: number }[];

  // suppress unused variable warning
  void rows;

  return raw.map((r) => ({
    symbol:       r.symbol,
    winRate:      r.win_rate,
    avgProfitUsd: r.avg_profit_usd,
    tradeCount:   r.trade_count,
  }));
}

/**
 * Hourly P&L breakdown — identify which hours are most profitable.
 * Use this to schedule the scanner more aggressively during peak hours.
 */
export function getHourlyPerformance(): {
  hour:         number;
  tradeCount:   number;
  totalProfit:  number;
  avgProfit:    number;
}[] {
  return db.all(
    sql`
      SELECT
        CAST(strftime('%H', datetime(executed_at / 1000, 'unixepoch')) AS INTEGER) AS hour,
        COUNT(*)                                  AS trade_count,
        ROUND(SUM(actual_profit_usd), 2)          AS total_profit,
        ROUND(AVG(actual_profit_usd), 4)          AS avg_profit
      FROM trade_results
      WHERE status = 'success'
      GROUP BY hour
      ORDER BY total_profit DESC
    `
  ) as { hour: number; trade_count: number; total_profit: number; avg_profit: number }[];
}

/**
 * Average slippage estimation error per exchange.
 * If slippage_error_pct is consistently positive for an exchange,
 * we're under-estimating slippage — bump BASE_SLIPPAGE for that exchange.
 */
export function getSlippageAccuracyByExchange(): {
  exchange:         string;
  avgSlippageError: number;
  sampleCount:      number;
}[] {
  return db.all(
    sql`
      SELECT
        o.buy_exchange           AS exchange,
        ROUND(AVG(t.slippage_error_pct), 5) AS avg_slippage_error,
        COUNT(t.id)              AS sample_count
      FROM trade_results t
      JOIN opportunities o ON t.opportunity_id = o.id
      GROUP BY o.buy_exchange
      ORDER BY ABS(AVG(t.slippage_error_pct)) DESC
    `
  ) as { exchange: string; avg_slippage_error: number; sample_count: number }[];
}

/**
 * Session P&L summary — used by Risk Manager and end-of-loop report.
 */
export function getSessionSummary(sinceMs: number): {
  totalProfitUsd:  number;
  tradeCount:      number;
  successCount:    number;
  winRate:         number;
  avgProfitUsd:    number;
} {
  const row = db.get(
    sql`
      SELECT
        COALESCE(SUM(actual_profit_usd), 0)    AS total_profit_usd,
        COUNT(*)                               AS trade_count,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count
      FROM trade_results
      WHERE executed_at >= ${sinceMs}
    `
  ) as { total_profit_usd: number; trade_count: number; success_count: number };

  return {
    totalProfitUsd: row.total_profit_usd,
    tradeCount:     row.trade_count,
    successCount:   row.success_count,
    winRate:        row.trade_count > 0 ? row.success_count / row.trade_count : 0,
    avgProfitUsd:   row.trade_count > 0 ? row.total_profit_usd / row.trade_count : 0,
  };
}

// ==========================================================================
// D. MAINTENANCE
// ==========================================================================

/**
 * Delete price_ticks older than ttlMs (default 60 s).
 * Call this at the start of each scan cycle.
 */
export function pruneStaleTicksRepo(ttlMs = 60_000): number {
  const result = db
    .delete(priceTicks)
    .where(sql`scanned_at < ${Date.now() - ttlMs}`)
    .run();
  return result.changes;
}

/**
 * Delete spreads older than maxAgeDays (default 7 days).
 * Spreads are useful for short-term analytics; purge stale ones.
 */
export function purgeOldSpreads(maxAgeDays = 7): number {
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  const result = db
    .delete(spreads)
    .where(sql`scanned_at < ${cutoff}`)
    .run();
  return result.changes;
}
