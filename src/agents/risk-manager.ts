/**
 * Risk Manager Agent
 *
 * Monitors open positions, enforces risk limits (max drawdown, daily loss cap,
 * win rate floor), generates performance reports, and issues halt signals.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  type Exchange,
  type Position,
  type PortfolioSnapshot,
  type RiskReport,
  type TradeResult,
} from "../types.js";
import { insertRiskSnapshot, getSessionSummary } from "../db/repository.js";

const client = new Anthropic();

// ---------------------------------------------------------------------------
// Risk configuration
// ---------------------------------------------------------------------------

const RISK_CONFIG = {
  maxDrawdownPct:      5.0,
  maxPositionSizeUSD: 50_000,
  dailyLossCapUSD:   -2_000,
  maxOpenPositions:     10,
  minWinRate:          0.55,
};

// ---------------------------------------------------------------------------
// Mock portfolio state
// ---------------------------------------------------------------------------

let mockPortfolio: PortfolioSnapshot = {
  totalValueUSD:       100_000,
  availableCapitalUSD:  75_000,
  openPositions:        [],
  dailyPnlUSD:          350,
  dailyPnlPct:          0.35,
  maxDrawdownPct:        1.2,
  winRate:              0.67,
  tradeCount:           15,
};

// ---------------------------------------------------------------------------
// Tool definitions (raw JSON schema)
// ---------------------------------------------------------------------------

const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_portfolio",
    description: "Retrieve the current portfolio snapshot including total value, available capital, open positions, and daily P&L.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_open_positions",
    description: "List all currently open arbitrage positions with unrealized P&L.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "check_risk_limits",
    description: "Evaluate current portfolio metrics against configured risk limits.",
    input_schema: {
      type: "object",
      properties: {
        totalValueUSD:       { type: "number" },
        availableCapitalUSD: { type: "number" },
        dailyPnlUSD:         { type: "number" },
        maxDrawdownPct:      { type: "number" },
        winRate:             { type: "number" },
        openPositionCount:   { type: "number" },
      },
      required: ["totalValueUSD", "availableCapitalUSD", "dailyPnlUSD", "maxDrawdownPct", "winRate", "openPositionCount"],
    },
  },
  {
    name: "calculate_pnl",
    description: "Compute realized P&L across a set of trade results, broken down by symbol.",
    input_schema: {
      type: "object",
      properties: {
        tradeResults: { type: "array", items: { type: "object" } },
        period:       { type: "string", enum: ["session", "daily", "weekly"] },
      },
      required: ["tradeResults"],
    },
  },
  {
    name: "set_stop_loss",
    description: "Register a stop-loss price for a symbol on an open position.",
    input_schema: {
      type: "object",
      properties: {
        symbol:        { type: "string" },
        stopLossPrice: { type: "number" },
        positionSide:  { type: "string", enum: ["long", "short"] },
      },
      required: ["symbol", "stopLossPrice", "positionSide"],
    },
  },
  {
    name: "issue_trading_halt",
    description: "Issue a trading halt signal when risk limits are critically breached.",
    input_schema: {
      type: "object",
      properties: {
        reason:   { type: "string" },
        severity: { type: "string", enum: ["warning", "halt", "emergency"] },
        duration: { type: "number", description: "Halt duration in minutes (omit for indefinite)" },
      },
      required: ["reason", "severity"],
    },
  },
  {
    name: "generate_report",
    description: "Generate a comprehensive risk and performance report for the specified period.",
    input_schema: {
      type: "object",
      properties: {
        period:                 { type: "string", enum: ["session", "daily", "weekly"] },
        includeRecommendations: { type: "boolean" },
      },
      required: [],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

type ToolInput = Record<string, unknown>;

async function handleTool(name: string, input: ToolInput): Promise<string> {
  switch (name) {
    case "get_portfolio": {
      mockPortfolio.totalValueUSD += (Math.random() - 0.48) * 50;
      mockPortfolio.dailyPnlUSD   += (Math.random() - 0.48) * 20;
      mockPortfolio.dailyPnlPct    = (mockPortfolio.dailyPnlUSD / mockPortfolio.totalValueUSD) * 100;
      return JSON.stringify(mockPortfolio);
    }

    case "get_open_positions": {
      const positions: Position[] = mockPortfolio.openPositions.length > 0
        ? mockPortfolio.openPositions
        : [{ symbol: "ETH/USDT", exchange: "binance" as Exchange, side: "long", amount: 2.0, entryPrice: 3490, currentPrice: 3512, unrealizedPnl: 44, unrealizedPnlPct: 0.63 }];
      return JSON.stringify({ positions, count: positions.length });
    }

    case "check_risk_limits": {
      const { dailyPnlUSD, maxDrawdownPct, winRate, openPositionCount } = input as Record<string, number>;
      const checks = {
        drawdown:      { pass: maxDrawdownPct    <= RISK_CONFIG.maxDrawdownPct,    value: maxDrawdownPct,    limit: RISK_CONFIG.maxDrawdownPct    },
        dailyLoss:     { pass: dailyPnlUSD       >= RISK_CONFIG.dailyLossCapUSD,   value: dailyPnlUSD,       limit: RISK_CONFIG.dailyLossCapUSD   },
        openPositions: { pass: openPositionCount <= RISK_CONFIG.maxOpenPositions,  value: openPositionCount, limit: RISK_CONFIG.maxOpenPositions   },
        winRate:       { pass: winRate           >= RISK_CONFIG.minWinRate,        value: winRate,           limit: RISK_CONFIG.minWinRate         },
      };
      const riskLevel =
        !checks.drawdown.pass || !checks.dailyLoss.pass ? "critical"
        : !checks.winRate.pass                          ? "high"
        : !checks.openPositions.pass                    ? "medium"
        : "low";
      return JSON.stringify({ checks, allPass: Object.values(checks).every((c) => c.pass), riskLevel, config: RISK_CONFIG });
    }

    case "calculate_pnl": {
      const results = input.tradeResults as TradeResult[];
      const period  = (input.period as string) ?? "session";
      const total   = results.reduce((s, r) => s + (r.actualProfitUSD ?? 0), 0);
      const success = results.filter((r) => r.status === "success").length;
      const bySymbol = results.reduce<Record<string, number>>((acc, r) => {
        const sym = r.buyOrder?.symbol ?? "unknown";
        acc[sym] = (acc[sym] ?? 0) + (r.actualProfitUSD ?? 0);
        return acc;
      }, {});
      return JSON.stringify({ period, totalProfitUSD: total, winRate: results.length ? success / results.length : 0, successCount: success, tradeCount: results.length, bySymbol });
    }

    case "set_stop_loss": {
      console.log(`[RiskManager] Stop-loss: ${input.symbol} | side=${input.positionSide} | trigger=$${input.stopLossPrice}`);
      return JSON.stringify({ registered: true, ...input, timestamp: Date.now() });
    }

    case "issue_trading_halt": {
      console.warn(`[RiskManager] ⚠️  TRADING ${String(input.severity).toUpperCase()}: ${input.reason}`);
      return JSON.stringify({ halted: true, ...input, timestamp: Date.now() });
    }

    case "generate_report": {
      const period = (input.period as string) ?? "session";
      const alerts: string[] = [];
      const recommendations: string[] = [];

      if (mockPortfolio.maxDrawdownPct > RISK_CONFIG.maxDrawdownPct)
        alerts.push(`CRITICAL: Drawdown ${mockPortfolio.maxDrawdownPct.toFixed(2)}% exceeds ${RISK_CONFIG.maxDrawdownPct}% limit`);
      if (mockPortfolio.dailyPnlUSD < RISK_CONFIG.dailyLossCapUSD)
        alerts.push(`CRITICAL: Daily loss $${mockPortfolio.dailyPnlUSD.toFixed(2)} exceeds cap`);
      if (mockPortfolio.winRate < RISK_CONFIG.minWinRate)
        alerts.push(`WARNING: Win rate ${(mockPortfolio.winRate * 100).toFixed(1)}% below ${RISK_CONFIG.minWinRate * 100}% minimum`);

      if (alerts.length === 0) {
        recommendations.push("System operating within all risk parameters");
        recommendations.push(`Win rate ${(mockPortfolio.winRate * 100).toFixed(1)}% — consider increasing trade size if sustained`);
      } else {
        recommendations.push("Review and reduce position sizes");
      }

      const riskLevel: RiskReport["riskLevel"] =
        alerts.some((a) => a.startsWith("CRITICAL")) ? "critical"
        : alerts.some((a) => a.startsWith("WARNING"))  ? "high"
        : "low";

      const report: RiskReport = {
        timestamp:      Date.now(),
        portfolio:      mockPortfolio,
        riskLevel,
        alerts,
        recommendations,
      };
      insertRiskSnapshot(report); // persist snapshot
      return JSON.stringify({ period, report });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

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

Be conservative — protect capital above all else.`;

  const userPrompt =
    prompt ??
    `Perform a full risk assessment. Session trade results: ${JSON.stringify(tradeResults.slice(0, 20))}. ` +
    `Check all risk limits, update stop-losses, and generate a report.`;

  console.log("[RiskManager] Running risk assessment...");

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userPrompt },
  ];

  while (true) {
    const response = await client.messages.create({
      model:      "claude-opus-4-6",
      max_tokens: 8192,
      thinking:   { type: "adaptive" },
      system:     systemPrompt,
      tools:      TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      console.log("[RiskManager] Result:\n", text);
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const result = await handleTool(block.name, block.input as ToolInput);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }
    }
    if (toolResults.length > 0) {
      messages.push({ role: "user", content: toolResults });
    }
  }

  return null;
}

// Run standalone
if (process.argv[1]?.endsWith("risk-manager.ts")) {
  await runRiskManager();
}
