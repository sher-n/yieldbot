/**
 * Drizzle ORM schema — SQLite (better-sqlite3)
 *
 * Six tables, designed to:
 *   1. Cache exchange prices so we skip redundant API calls (cuts costs)
 *   2. Record every spread/opportunity for analytics-driven threshold tuning
 *   3. Track every order and trade outcome for P&L reconciliation
 *   4. Snapshot risk state over time to detect regime changes
 *
 * No foreign-key constraints (SQLite FKs need per-connection PRAGMA; we keep
 * it simple and use string IDs to link rows — easy to join, easy to migrate).
 */

import {
  sqliteTable,
  text,
  real,
  integer,
  index,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// 1. price_ticks
//    Short-lived cache of raw ticker data from each exchange.
//    Prune rows older than CONFIG.tickTtlMs (default 60 s) to stay lean.
//    Used by market-scanner to skip exchanges that were just queried.
// ---------------------------------------------------------------------------

export const priceTicks = sqliteTable(
  "price_ticks",
  {
    id:        integer("id").primaryKey({ autoIncrement: true }),
    exchange:  text("exchange").notNull(),
    symbol:    text("symbol").notNull(),
    bid:       real("bid").notNull(),
    ask:       real("ask").notNull(),
    last:      real("last").notNull(),
    volume24h: real("volume_24h").notNull(),
    scannedAt: integer("scanned_at").notNull(), // ms epoch
  },
  (t) => [
    // Cache lookup: "give me a fresh BTC/USDT tick from Binance"
    index("idx_ticks_symbol_exchange_time").on(t.symbol, t.exchange, t.scannedAt),
  ]
);

// ---------------------------------------------------------------------------
// 2. spreads
//    Every raw cross-exchange price divergence the scanner detects.
//    One row per (symbol, buyExchange, sellExchange) observation.
//    Analytics: track spread frequency and magnitude over time.
// ---------------------------------------------------------------------------

export const spreads = sqliteTable(
  "spreads",
  {
    id:          integer("id").primaryKey({ autoIncrement: true }),
    symbol:      text("symbol").notNull(),
    buyExchange: text("buy_exchange").notNull(),
    sellExchange:text("sell_exchange").notNull(),
    buyPrice:    real("buy_price").notNull(),
    sellPrice:   real("sell_price").notNull(),
    spreadPct:   real("spread_pct").notNull(),
    scannedAt:   integer("scanned_at").notNull(),
  },
  (t) => [
    index("idx_spreads_symbol_time").on(t.symbol, t.scannedAt),
    // Top-N spreads queries
    index("idx_spreads_pct").on(t.spreadPct),
  ]
);

// ---------------------------------------------------------------------------
// 3. opportunities
//    Fully-analyzed opportunities: gross spread + net profit after fees and
//    estimated slippage. One row per analysis call regardless of viability.
//
//    Key analytics columns:
//      slippage_pct        — our estimate at analysis time
//      viable              — did it pass the 0.05% net-profit floor?
//
//    After trades settle, UPDATE estimated_profit_usd vs actual to score
//    the model's accuracy over time (see repository.updateOpportunityActual).
// ---------------------------------------------------------------------------

export const opportunities = sqliteTable(
  "opportunities",
  {
    id:                 text("id").primaryKey(),       // OPP-xxx
    spreadId:           integer("spread_id"),          // → spreads.id (soft FK)
    symbol:             text("symbol").notNull(),
    buyExchange:        text("buy_exchange").notNull(),
    sellExchange:       text("sell_exchange").notNull(),
    buyPrice:           real("buy_price").notNull(),
    sellPrice:          real("sell_price").notNull(),
    spreadPct:          real("spread_pct").notNull(),
    grossProfitPct:     real("gross_profit_pct").notNull(),
    netProfitPct:       real("net_profit_pct").notNull(),
    estimatedProfitUsd: real("estimated_profit_usd").notNull(),
    requiredCapitalUsd: real("required_capital_usd").notNull(),
    buyFee:             real("buy_fee").notNull(),
    sellFee:            real("sell_fee").notNull(),
    slippagePct:        real("slippage_pct").notNull(),
    viable:             integer("viable", { mode: "boolean" }).notNull(),
    reason:             text("reason"),                // why non-viable
    analyzedAt:         integer("analyzed_at").notNull(),
  },
  (t) => [
    // Filter viable + sort by profitability (Trade Executor's main query)
    index("idx_opp_viable_profit").on(t.viable, t.netProfitPct),
    // Per-pair analytics: which exchange combos consistently yield edge?
    index("idx_opp_pair").on(t.buyExchange, t.sellExchange),
    index("idx_opp_symbol").on(t.symbol),
    index("idx_opp_time").on(t.analyzedAt),
  ]
);

// ---------------------------------------------------------------------------
// 4. orders
//    Every individual order placed on an exchange, including fills.
//    Linked to an opportunity via opportunityId (nullable for manual orders).
//
//    Analytics: average fill quality (avg_fill_price vs price) per exchange.
// ---------------------------------------------------------------------------

export const orders = sqliteTable(
  "orders",
  {
    id:            text("id").primaryKey(),           // ORD-xxxxxx
    opportunityId: text("opportunity_id"),             // → opportunities.id
    exchange:      text("exchange").notNull(),
    symbol:        text("symbol").notNull(),
    side:          text("side").notNull(),             // 'buy' | 'sell'
    orderType:     text("order_type").notNull(),       // 'market' | 'limit'
    amount:        real("amount").notNull(),
    price:         real("price"),                      // null for market orders at placement
    status:        text("status").notNull(),           // 'open'|'filled'|'partial'|'cancelled'
    filledAmount:  real("filled_amount").notNull().default(0),
    avgFillPrice:  real("avg_fill_price").notNull().default(0),
    placedAt:      integer("placed_at").notNull(),
  },
  (t) => [
    index("idx_orders_opportunity").on(t.opportunityId),
    // Monitor open orders across exchanges
    index("idx_orders_exchange_status").on(t.exchange, t.status),
    index("idx_orders_symbol").on(t.symbol),
  ]
);

// ---------------------------------------------------------------------------
// 5. trade_results
//    One row per completed arbitrage round-trip (buy leg + sell leg).
//    The single most important table for measuring actual performance.
//
//    slippage_error_pct = (actual_slippage - estimated_slippage).
//    Accumulate this to recalibrate the Opportunity Analyzer's slippage model.
// ---------------------------------------------------------------------------

export const tradeResults = sqliteTable(
  "trade_results",
  {
    id:                 integer("id").primaryKey({ autoIncrement: true }),
    opportunityId:      text("opportunity_id").notNull(),
    buyOrderId:         text("buy_order_id").notNull(),
    sellOrderId:        text("sell_order_id").notNull(),
    estimatedProfitUsd: real("estimated_profit_usd").notNull(), // from opportunity
    actualProfitUsd:    real("actual_profit_usd").notNull(),
    actualProfitPct:    real("actual_profit_pct").notNull(),
    slippageErrorPct:   real("slippage_error_pct").notNull().default(0), // actual - estimated
    status:             text("status").notNull(),               // 'success'|'partial'|'failed'
    executedAt:         integer("executed_at").notNull(),
  },
  (t) => [
    // Time-series: P&L by hour, day, week
    index("idx_trades_time").on(t.executedAt),
    index("idx_trades_status").on(t.status),
    // Per-pair performance analytics
    index("idx_trades_opportunity").on(t.opportunityId),
  ]
);

// ---------------------------------------------------------------------------
// 6. risk_snapshots
//    Point-in-time portfolio + risk metric captures.
//    Run after every trade cycle. Detect drawdown trends before they breach.
//    alerts / recommendations stored as JSON arrays.
// ---------------------------------------------------------------------------

export const riskSnapshots = sqliteTable(
  "risk_snapshots",
  {
    id:                  integer("id").primaryKey({ autoIncrement: true }),
    riskLevel:           text("risk_level").notNull(),          // 'low'|'medium'|'high'|'critical'
    totalValueUsd:       real("total_value_usd").notNull(),
    availableCapitalUsd: real("available_capital_usd").notNull(),
    dailyPnlUsd:         real("daily_pnl_usd").notNull(),
    dailyPnlPct:         real("daily_pnl_pct").notNull(),
    maxDrawdownPct:      real("max_drawdown_pct").notNull(),
    winRate:             real("win_rate").notNull(),
    tradeCount:          integer("trade_count").notNull(),
    alertsJson:          text("alerts_json").notNull().default("[]"),
    reportedAt:          integer("reported_at").notNull(),
  },
  (t) => [
    index("idx_risk_time").on(t.reportedAt),
    index("idx_risk_level").on(t.riskLevel),
  ]
);
