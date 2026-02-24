/**
 * YieldBot — Crypto Arbitrage Agent Orchestrator
 *
 * Coordinates all four agents in a continuous loop:
 *
 *  ┌─────────────────────┐
 *  │   Market Scanner    │  → Scans exchanges, finds price spreads
 *  └────────┬────────────┘
 *           │ ArbitrageSpread[]
 *  ┌────────▼────────────┐
 *  │ Opportunity Analyzer│  → Filters by net profit after fees/slippage
 *  └────────┬────────────┘
 *           │ ArbitrageOpportunity[]
 *  ┌────────▼────────────┐
 *  │   Trade Executor    │  → Executes buy + sell legs simultaneously
 *  └────────┬────────────┘
 *           │ TradeResult[]
 *  ┌────────▼────────────┐
 *  │    Risk Manager     │  → Monitors P&L, enforces limits, reports
 *  └─────────────────────┘
 */

import { runMarketScanner }       from "./agents/market-scanner.js";
import { runOpportunityAnalyzer } from "./agents/opportunity-analyzer.js";
import { runTradeExecutor }       from "./agents/trade-executor.js";
import { runRiskManager }         from "./agents/risk-manager.js";
import type {
  ArbitrageSpread,
  ArbitrageOpportunity,
  TradeResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONFIG = {
  scanIntervalMs:   30_000,  // Scan every 30 seconds
  tradeAmountUSD:   10_000,  // Capital per trade
  minSpreadPct:     0.20,    // Minimum gross spread to consider
  maxIterations:    Infinity, // Set to a number for finite runs
  dryRun:           true,    // true = simulate, false = live trading
};

// ---------------------------------------------------------------------------
// Orchestration loop
// ---------------------------------------------------------------------------

async function runArbitrageLoop(maxIterations = CONFIG.maxIterations) {
  console.log("=".repeat(60));
  console.log("  YieldBot Crypto Arbitrage System — Starting");
  console.log(`  Mode: ${CONFIG.dryRun ? "DRY RUN (simulated)" : "LIVE TRADING"}`);
  console.log(`  Trade size: $${CONFIG.tradeAmountUSD.toLocaleString()}`);
  console.log(`  Scan interval: ${CONFIG.scanIntervalMs / 1000}s`);
  console.log("=".repeat(60));

  const sessionResults: TradeResult[] = [];
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;
    console.log(`\n${"─".repeat(60)}`);
    console.log(`  Iteration ${iteration} — ${new Date().toISOString()}`);
    console.log("─".repeat(60));

    try {
      // ── Step 1: Market Scanner ──────────────────────────────────────────
      console.log("\n[1/4] Market Scanner Agent");
      const spreads: ArbitrageSpread[] = await runMarketScanner();

      if (spreads.length === 0) {
        console.log("      No spreads above threshold found — skipping cycle.");
        await sleep(CONFIG.scanIntervalMs);
        continue;
      }

      // ── Step 2: Opportunity Analyzer ────────────────────────────────────
      console.log("\n[2/4] Opportunity Analyzer Agent");
      const opportunities: ArbitrageOpportunity[] =
        await runOpportunityAnalyzer(spreads, CONFIG.tradeAmountUSD);

      if (opportunities.length === 0) {
        console.log("      No viable opportunities after fee/slippage analysis.");
        await sleep(CONFIG.scanIntervalMs);
        continue;
      }

      // ── Step 3: Trade Executor ───────────────────────────────────────────
      if (CONFIG.dryRun) {
        console.log("\n[3/4] Trade Executor Agent — DRY RUN (skipping live orders)");
      } else {
        console.log("\n[3/4] Trade Executor Agent");
        const results: TradeResult[] = await runTradeExecutor(opportunities);
        sessionResults.push(...results);
      }

      // ── Step 4: Risk Manager ─────────────────────────────────────────────
      console.log("\n[4/4] Risk Manager Agent");
      const report = await runRiskManager(sessionResults);

      if (report?.riskLevel === "critical") {
        console.error("\n⛔  CRITICAL RISK LEVEL — Halting trading loop.");
        break;
      }

    } catch (err) {
      console.error("[Orchestrator] Error in cycle:", err);
    }

    if (iteration < maxIterations) {
      console.log(`\n⏳  Next scan in ${CONFIG.scanIntervalMs / 1000}s...`);
      await sleep(CONFIG.scanIntervalMs);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("  YieldBot — Session Complete");
  console.log(`  Total trades executed: ${sessionResults.length}`);
  const totalProfit = sessionResults.reduce(
    (sum, r) => sum + r.actualProfitUSD,
    0
  );
  console.log(`  Total realized profit: $${totalProfit.toFixed(2)}`);
  console.log("=".repeat(60));
}

// ---------------------------------------------------------------------------
// Single-shot demo (no loop)
// ---------------------------------------------------------------------------

async function runDemo() {
  console.log("=".repeat(60));
  console.log("  YieldBot — Single Scan Demo");
  console.log("=".repeat(60));

  console.log("\n[1/4] Running Market Scanner Agent...");
  await runMarketScanner();

  console.log("\n[2/4] Running Opportunity Analyzer Agent...");
  await runOpportunityAnalyzer([], CONFIG.tradeAmountUSD);

  console.log("\n[3/4] Running Trade Executor Agent...");
  await runTradeExecutor([]);

  console.log("\n[4/4] Running Risk Manager Agent...");
  await runRiskManager();

  console.log("\n✅  Demo complete.");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.includes("--loop")) {
  const iterations = args.includes("--iterations")
    ? parseInt(args[args.indexOf("--iterations") + 1] ?? "3", 10)
    : 2;
  await runArbitrageLoop(iterations);
} else {
  await runDemo();
}
