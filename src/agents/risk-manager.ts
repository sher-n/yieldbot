/**
 * Risk Manager Agent
 *
 * Continuously monitors open positions, enforces risk limits (max drawdown,
 * position size, daily loss cap), generates performance reports, and issues
 * alerts or halt signals when thresholds are breached.
 */

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import {
  type Exchange,
  type Position,
  type PortfolioSnapshot,
  type RiskReport,
  type TradeResult,
} from "../types.js";

const client = new Anthropic();

// ---------------------------------------------------------------------------
// Risk configuration — tune these for production
// ---------------------------------------------------------------------------

const RISK_CONFIG = {
  maxDrawdownPct:       5.0,   // Halt if drawdown exceeds 5%
  maxPositionSizeUSD:  50_000, // No single position > $50k
  dailyLossCapUSD:    -2_000,  // Stop trading if daily loss > $2k
  maxOpenPositions:       10,  // No more than 10 simultaneous trades
  minWinRate:          0.55,   // Alert if win rate drops below 55%
  maxSlippagePct:        0.5,  // Alert if avg slippage > 0.5%
};

// ---------------------------------------------------------------------------
// Mock portfolio state (replace with real DB / exchange API)
// ---------------------------------------------------------------------------

let mockPortfolio: PortfolioSnapshot = {
  totalValueUSD:       100_000,
  availableCapitalUSD:  75_000,
  openPositions: [],
  dailyPnlUSD:          350,
  dailyPnlPct:          0.35,
  maxDrawdownPct:        1.2,
  winRate:              0.67,
  tradeCount:           15,
};

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const getPortfolioTool = betaZodTool({
  name: "get_portfolio",
  description:
    "Retrieve the current portfolio snapshot including total value, " +
    "available capital, open positions, and daily P&L.",
  inputSchema: z.object({}),
  run: async () => {
    // Add slight drift to simulate live market movement
    mockPortfolio.totalValueUSD += (Math.random() - 0.48) * 50;
    mockPortfolio.dailyPnlUSD   += (Math.random() - 0.48) * 20;
    mockPortfolio.dailyPnlPct    =
      (mockPortfolio.dailyPnlUSD / mockPortfolio.totalValueUSD) * 100;
    return JSON.stringify(mockPortfolio);
  },
});

const getOpenPositionsTool = betaZodTool({
  name: "get_open_positions",
  description: "List all currently open arbitrage positions with unrealized P&L.",
  inputSchema: z.object({}),
  run: async () => {
    // Simulate a couple of open positions for demo
    const positions: Position[] = mockPortfolio.openPositions.length > 0
      ? mockPortfolio.openPositions
      : [
          {
            symbol:           "ETH/USDT",
            exchange:         "binance" as Exchange,
            side:             "long",
            amount:           2.0,
            entryPrice:       3490,
            currentPrice:     3512,
            unrealizedPnl:    44,
            unrealizedPnlPct: 0.63,
          },
        ];
    return JSON.stringify({ positions, count: positions.length });
  },
});

const checkRiskLimitsTool = betaZodTool({
  name: "check_risk_limits",
  description:
    "Evaluate current portfolio metrics against configured risk limits. " +
    "Returns a pass/fail for each limit and overall risk status.",
  inputSchema: z.object({
    totalValueUSD:       z.number(),
    availableCapitalUSD: z.number(),
    dailyPnlUSD:         z.number(),
    maxDrawdownPct:      z.number(),
    winRate:             z.number(),
    openPositionCount:   z.number(),
  }),
  run: async ({
    dailyPnlUSD,
    maxDrawdownPct,
    winRate,
    openPositionCount,
  }) => {
    const checks = {
      drawdown:      { pass: maxDrawdownPct <= RISK_CONFIG.maxDrawdownPct,       value: maxDrawdownPct,     limit: RISK_CONFIG.maxDrawdownPct       },
      dailyLoss:     { pass: dailyPnlUSD    >= RISK_CONFIG.dailyLossCapUSD,      value: dailyPnlUSD,        limit: RISK_CONFIG.dailyLossCapUSD      },
      openPositions: { pass: openPositionCount <= RISK_CONFIG.maxOpenPositions,  value: openPositionCount,  limit: RISK_CONFIG.maxOpenPositions     },
      winRate:       { pass: winRate        >= RISK_CONFIG.minWinRate,           value: winRate,            limit: RISK_CONFIG.minWinRate           },
    };

    const allPass = Object.values(checks).every((c) => c.pass);
    const riskLevel =
      !checks.drawdown.pass || !checks.dailyLoss.pass
        ? "critical"
        : !checks.winRate.pass
        ? "high"
        : !checks.openPositions.pass
        ? "medium"
        : "low";

    return JSON.stringify({ checks, allPass, riskLevel, config: RISK_CONFIG });
  },
});

const calculatePnlTool = betaZodTool({
  name: "calculate_pnl",
  description:
    "Compute realized and unrealized P&L across a set of trade results, " +
    "broken down by symbol and exchange pair.",
  inputSchema: z.object({
    tradeResults: z
      .array(z.record(z.unknown()))
      .describe("Array of TradeResult objects"),
    period: z
      .enum(["session", "daily", "weekly"])
      .default("session")
      .describe("Aggregation period"),
  }),
  run: async ({ tradeResults, period }) => {
    const results = tradeResults as TradeResult[];
    const totalProfitUSD = results.reduce(
      (sum, r) => sum + (r.actualProfitUSD ?? 0),
      0
    );
    const successCount = results.filter((r) => r.status === "success").length;
    const partialCount = results.filter((r) => r.status === "partial").length;
    const failedCount  = results.filter((r) => r.status === "failed").length;
    const winRate      = results.length > 0 ? successCount / results.length : 0;

    const bySymbol = results.reduce<Record<string, number>>((acc, r) => {
      const sym = r.buyOrder?.symbol ?? "unknown";
      acc[sym] = (acc[sym] ?? 0) + (r.actualProfitUSD ?? 0);
      return acc;
    }, {});

    return JSON.stringify({
      period,
      totalProfitUSD,
      winRate,
      successCount,
      partialCount,
      failedCount,
      tradeCount: results.length,
      bySymbol,
    });
  },
});

const setStopLossTool = betaZodTool({
  name: "set_stop_loss",
  description:
    "Register a stop-loss price for a symbol. If the market reaches this " +
    "level, all open positions for that symbol will be closed.",
  inputSchema: z.object({
    symbol:         z.string(),
    stopLossPrice:  z.number().describe("Price at which to trigger stop loss"),
    positionSide:   z.enum(["long", "short"]),
  }),
  run: async ({ symbol, stopLossPrice, positionSide }) => {
    console.log(
      `[RiskManager] Stop-loss set: ${symbol} | side=${positionSide} | trigger=$${stopLossPrice}`
    );
    return JSON.stringify({
      registered: true,
      symbol,
      stopLossPrice,
      positionSide,
      timestamp: Date.now(),
    });
  },
});

const issueTradingHaltTool = betaZodTool({
  name: "issue_trading_halt",
  description:
    "Issue a trading halt signal when risk limits are critically breached. " +
    "This prevents new trades from being submitted until conditions improve.",
  inputSchema: z.object({
    reason:    z.string().describe("Human-readable reason for the halt"),
    severity:  z.enum(["warning", "halt", "emergency"]),
    duration:  z
      .number()
      .optional()
      .describe("Halt duration in minutes (omit for indefinite)"),
  }),
  run: async ({ reason, severity, duration }) => {
    console.warn(`[RiskManager] ⚠️  TRADING ${severity.toUpperCase()}: ${reason}`);
    return JSON.stringify({
      halted: true,
      severity,
      reason,
      duration: duration ?? "indefinite",
      timestamp: Date.now(),
    });
  },
});

const generateReportTool = betaZodTool({
  name: "generate_report",
  description:
    "Generate a comprehensive risk and performance report for the specified " +
    "period, including P&L, risk metrics, alerts, and recommendations.",
  inputSchema: z.object({
    period: z
      .enum(["session", "daily", "weekly"])
      .default("session")
      .describe("Report period"),
    includeRecommendations: z
      .boolean()
      .default(true)
      .describe("Include actionable recommendations"),
  }),
  run: async ({ period, includeRecommendations }) => {
    const portfolio = mockPortfolio;

    const alerts: string[] = [];
    const recommendations: string[] = [];

    if (portfolio.maxDrawdownPct > RISK_CONFIG.maxDrawdownPct) {
      alerts.push(`CRITICAL: Drawdown ${portfolio.maxDrawdownPct.toFixed(2)}% exceeds limit of ${RISK_CONFIG.maxDrawdownPct}%`);
      recommendations.push("Reduce position sizes immediately and review losing trades");
    }
    if (portfolio.dailyPnlUSD < RISK_CONFIG.dailyLossCapUSD) {
      alerts.push(`CRITICAL: Daily loss $${portfolio.dailyPnlUSD.toFixed(2)} exceeds cap of $${RISK_CONFIG.dailyLossCapUSD}`);
      recommendations.push("Halt trading for the rest of the session");
    }
    if (portfolio.winRate < RISK_CONFIG.minWinRate) {
      alerts.push(`WARNING: Win rate ${(portfolio.winRate * 100).toFixed(1)}% below minimum ${RISK_CONFIG.minWinRate * 100}%`);
      recommendations.push("Review opportunity selection criteria — spread threshold may need raising");
    }

    if (includeRecommendations && alerts.length === 0) {
      recommendations.push("System operating within all risk parameters");
      recommendations.push(`Current win rate ${(portfolio.winRate * 100).toFixed(1)}% — consider increasing trade size if sustained`);
    }

    const riskLevel: RiskReport["riskLevel"] =
      alerts.some((a) => a.startsWith("CRITICAL")) ? "critical"
      : alerts.some((a) => a.startsWith("WARNING"))  ? "high"
      : portfolio.maxDrawdownPct > RISK_CONFIG.maxDrawdownPct * 0.7 ? "medium"
      : "low";

    const report: RiskReport = {
      timestamp:      Date.now(),
      portfolio,
      riskLevel,
      alerts,
      recommendations,
    };

    return JSON.stringify({ period, report });
  },
});

// ---------------------------------------------------------------------------
// Agent runner
// ---------------------------------------------------------------------------

export async function runRiskManager(
  tradeResults: TradeResult[] = [],
  prompt?: string
): Promise<RiskReport | null> {
  const systemPrompt = `You are the Risk Manager Agent for a crypto arbitrage system.

Your responsibilities:
1. Monitor the current portfolio state and P&L
2. Evaluate all metrics against defined risk limits:
   - Max drawdown: ${RISK_CONFIG.maxDrawdownPct}%
   - Daily loss cap: $${Math.abs(RISK_CONFIG.dailyLossCapUSD).toLocaleString()}
   - Max open positions: ${RISK_CONFIG.maxOpenPositions}
   - Min win rate: ${(RISK_CONFIG.minWinRate * 100).toFixed(0)}%
3. Issue trading halts immediately if critical limits are breached
4. Set stop-losses for open positions at risk
5. Generate a comprehensive report with actionable recommendations

Be conservative and protect capital above all else. Issue a halt proactively if
approaching (80%+) any critical limit.`;

  const userPrompt =
    prompt ??
    `Perform a full risk assessment of the current portfolio. ` +
    `Trade results from this session: ${JSON.stringify(tradeResults.slice(0, 20))}. ` +
    `Check all risk limits, update stop-losses, and generate a report.`;

  console.log("[RiskManager] Running risk assessment...");

  const finalMessage = await client.beta.messages.toolRunner({
    model: "claude-opus-4-6",
    max_tokens: 8192,
    thinking: { type: "adaptive" },
    system: systemPrompt,
    tools: [
      getPortfolioTool,
      getOpenPositionsTool,
      checkRiskLimitsTool,
      calculatePnlTool,
      setStopLossTool,
      issueTradingHaltTool,
      generateReportTool,
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = finalMessage.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n");

  console.log("[RiskManager] Result:\n", text);
  return null;
}

// Run standalone
if (process.argv[1]?.endsWith("risk-manager.ts")) {
  await runRiskManager();
}
