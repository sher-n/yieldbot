/**
 * Opportunity Analyzer Agent
 *
 * Takes raw price spreads from the Market Scanner and evaluates each one for
 * true profitability by accounting for trading fees, estimated slippage, and
 * minimum capital requirements. Outputs only viable opportunities.
 */

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import {
  type Exchange,
  type ArbitrageSpread,
  type ArbitrageOpportunity,
  FEE_TABLE,
} from "../types.js";

const client = new Anthropic();

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const getFeeStructureTool = betaZodTool({
  name: "get_fee_structure",
  description:
    "Return the maker and taker fee rates for a given exchange. " +
    "Arbitrage trades are typically taker orders.",
  inputSchema: z.object({
    exchange: z
      .enum(["binance", "coinbase", "kraken", "okx", "bybit"])
      .describe("Exchange to query fees for"),
  }),
  run: async ({ exchange }) => {
    const fees = FEE_TABLE[exchange as Exchange];
    return JSON.stringify(fees);
  },
});

const estimateSlippageTool = betaZodTool({
  name: "estimate_slippage",
  description:
    "Estimate slippage for a market order based on order book depth. " +
    "Returns slippage as a decimal fraction (e.g. 0.001 = 0.1%).",
  inputSchema: z.object({
    exchange: z
      .enum(["binance", "coinbase", "kraken", "okx", "bybit"])
      .describe("Exchange where the order will be placed"),
    symbol: z.string().describe("Trading pair"),
    tradeAmountUSD: z
      .number()
      .describe("Size of the order in USD"),
  }),
  run: async ({ exchange, tradeAmountUSD }) => {
    // Simplified model: slippage scales with order size and varies by exchange
    const baseSlippage: Record<Exchange, number> = {
      binance:  0.0003,
      coinbase: 0.0008,
      kraken:   0.0006,
      okx:      0.0004,
      bybit:    0.0005,
    };
    const base = baseSlippage[exchange as Exchange] ?? 0.001;
    // Add 0.01% per $10k of order size beyond $1k
    const sizeAdder = Math.max(0, (tradeAmountUSD - 1000) / 10000) * 0.0001;
    const slippage = base + sizeAdder;
    return JSON.stringify({ exchange, slippage, slippagePct: slippage * 100 });
  },
});

const checkLiquidityTool = betaZodTool({
  name: "check_liquidity",
  description:
    "Verify whether an exchange has sufficient order book depth to fill " +
    "a trade of the requested size without excessive slippage.",
  inputSchema: z.object({
    exchange: z
      .enum(["binance", "coinbase", "kraken", "okx", "bybit"])
      .describe("Exchange to check"),
    symbol: z.string().describe("Trading pair"),
    tradeAmountUSD: z.number().describe("Trade size in USD"),
  }),
  run: async ({ exchange, tradeAmountUSD }) => {
    // Mock liquidity caps per exchange
    const maxLiquidity: Record<Exchange, number> = {
      binance:  5_000_000,
      coinbase: 2_000_000,
      kraken:   1_500_000,
      okx:      3_000_000,
      bybit:    2_500_000,
    };
    const cap = maxLiquidity[exchange as Exchange] ?? 1_000_000;
    const sufficient = tradeAmountUSD <= cap * 0.05; // cap at 5% of daily liquidity
    return JSON.stringify({
      exchange,
      tradeAmountUSD,
      maxRecommendedUSD: cap * 0.05,
      sufficient,
    });
  },
});

const calculateNetProfitTool = betaZodTool({
  name: "calculate_net_profit",
  description:
    "Compute the net profit of an arbitrage trade after fees and slippage. " +
    "Returns gross profit %, fee costs, net profit %, and absolute USD profit.",
  inputSchema: z.object({
    buyPrice: z.number().describe("Execution price on the buy leg (ask + slippage)"),
    sellPrice: z.number().describe("Execution price on the sell leg (bid - slippage)"),
    buyFeePct: z.number().describe("Taker fee on buy exchange as a decimal (e.g. 0.001)"),
    sellFeePct: z.number().describe("Taker fee on sell exchange as a decimal"),
    buySlippage: z.number().describe("Buy-side slippage as a decimal"),
    sellSlippage: z.number().describe("Sell-side slippage as a decimal"),
    tradeAmountUSD: z.number().describe("Capital deployed in USD"),
  }),
  run: async ({
    buyPrice,
    sellPrice,
    buyFeePct,
    sellFeePct,
    buySlippage,
    sellSlippage,
    tradeAmountUSD,
  }) => {
    const effectiveBuy  = buyPrice  * (1 + buySlippage)  * (1 + buyFeePct);
    const effectiveSell = sellPrice * (1 - sellSlippage) * (1 - sellFeePct);

    const grossProfitPct = ((sellPrice - buyPrice) / buyPrice) * 100;
    const netProfitPct   = ((effectiveSell - effectiveBuy) / effectiveBuy) * 100;
    const netProfitUSD   = (netProfitPct / 100) * tradeAmountUSD;

    const totalFeesPct   = (buyFeePct + sellFeePct) * 100;
    const totalSlippagePct = (buySlippage + sellSlippage) * 100;

    return JSON.stringify({
      grossProfitPct,
      netProfitPct,
      netProfitUSD,
      totalFeesPct,
      totalSlippagePct,
      effectiveBuy,
      effectiveSell,
      viable: netProfitPct > 0,
    });
  },
});

const analyzeOpportunityTool = betaZodTool({
  name: "analyze_opportunity",
  description:
    "Run a full profitability analysis on a single arbitrage spread, " +
    "combining fees, slippage, and liquidity checks into one verdict.",
  inputSchema: z.object({
    opportunityId: z.string().describe("Unique ID for this opportunity"),
    symbol: z.string(),
    buyExchange: z.enum(["binance", "coinbase", "kraken", "okx", "bybit"]),
    sellExchange: z.enum(["binance", "coinbase", "kraken", "okx", "bybit"]),
    buyPrice: z.number().describe("Raw ask price on buy exchange"),
    sellPrice: z.number().describe("Raw bid price on sell exchange"),
    spreadPct: z.number(),
    tradeAmountUSD: z
      .number()
      .default(10000)
      .describe("Capital to deploy (USD)"),
  }),
  run: async ({
    opportunityId,
    symbol,
    buyExchange,
    sellExchange,
    buyPrice,
    sellPrice,
    spreadPct,
    tradeAmountUSD,
  }) => {
    const buyFees  = FEE_TABLE[buyExchange  as Exchange];
    const sellFees = FEE_TABLE[sellExchange as Exchange];

    // Slippage model (same as estimate_slippage tool)
    const baseSlippage: Record<Exchange, number> = {
      binance:  0.0003,
      coinbase: 0.0008,
      kraken:   0.0006,
      okx:      0.0004,
      bybit:    0.0005,
    };
    const buySlippage  = baseSlippage[buyExchange  as Exchange] ?? 0.001;
    const sellSlippage = baseSlippage[sellExchange as Exchange] ?? 0.001;

    // Liquidity check
    const maxLiquidity: Record<Exchange, number> = {
      binance:  250_000,
      coinbase: 100_000,
      kraken:   75_000,
      okx:      150_000,
      bybit:    125_000,
    };
    const liquidityOk =
      tradeAmountUSD <= (maxLiquidity[buyExchange as Exchange] ?? 50_000) &&
      tradeAmountUSD <= (maxLiquidity[sellExchange as Exchange] ?? 50_000);

    // Net profit calculation
    const effectiveBuy  = buyPrice  * (1 + buySlippage)  * (1 + buyFees.taker);
    const effectiveSell = sellPrice * (1 - sellSlippage) * (1 - sellFees.taker);
    const netProfitPct  = ((effectiveSell - effectiveBuy) / effectiveBuy) * 100;
    const netProfitUSD  = (netProfitPct / 100) * tradeAmountUSD;

    const viable = netProfitPct > 0.05 && liquidityOk; // 0.05% min net profit
    const reason = !liquidityOk
      ? "Insufficient liquidity for requested trade size"
      : netProfitPct <= 0.05
      ? `Net profit ${netProfitPct.toFixed(4)}% is below 0.05% minimum after fees & slippage`
      : undefined;

    const opportunity: ArbitrageOpportunity = {
      id: opportunityId,
      spread: {
        symbol,
        buyExchange:  buyExchange  as Exchange,
        sellExchange: sellExchange as Exchange,
        buyPrice,
        sellPrice,
        spreadPct,
        timestamp: Date.now(),
      },
      grossProfitPct: spreadPct,
      netProfitPct,
      estimatedProfitUSD: netProfitUSD,
      requiredCapitalUSD: tradeAmountUSD,
      buyFee:  buyFees.taker,
      sellFee: sellFees.taker,
      slippagePct: (buySlippage + sellSlippage) * 100,
      viable,
      reason,
    };

    return JSON.stringify(opportunity);
  },
});

const rankOpportunitiesTool = betaZodTool({
  name: "rank_opportunities",
  description:
    "Given a list of analyzed opportunities, filter to only viable ones " +
    "and sort them by estimated net profit USD descending.",
  inputSchema: z.object({
    opportunities: z
      .array(z.record(z.unknown()))
      .describe("Array of ArbitrageOpportunity objects from analyze_opportunity"),
  }),
  run: async ({ opportunities }) => {
    const viable = opportunities
      .filter((o) => (o as ArbitrageOpportunity).viable)
      .sort(
        (a, b) =>
          (b as ArbitrageOpportunity).estimatedProfitUSD -
          (a as ArbitrageOpportunity).estimatedProfitUSD
      );
    return JSON.stringify({
      viable,
      viableCount: viable.length,
      totalAnalyzed: opportunities.length,
    });
  },
});

// ---------------------------------------------------------------------------
// Agent runner
// ---------------------------------------------------------------------------

export async function runOpportunityAnalyzer(
  spreads: ArbitrageSpread[],
  tradeAmountUSD = 10_000
): Promise<ArbitrageOpportunity[]> {
  const systemPrompt = `You are the Opportunity Analyzer Agent for a crypto arbitrage system.

Your job is to evaluate raw price spreads for true profitability by:
1. Fetching fee structures for both exchanges in each spread
2. Estimating slippage based on trade size and exchange liquidity
3. Calculating net profit after fees and slippage
4. Filtering out opportunities that don't meet the 0.05% net profit minimum
5. Ranking viable opportunities by absolute USD profit

Be thorough and conservative — only recommend trades with a clear edge after all costs.
Use analyze_opportunity for efficiency when you have all required data.`;

  const spreadsJson = JSON.stringify(spreads.slice(0, 20)); // limit context
  const userPrompt =
    `Analyze the following arbitrage spreads and determine which are truly profitable ` +
    `after fees and slippage. Trade size = $${tradeAmountUSD.toLocaleString()} per trade.\n\n` +
    `Spreads:\n${spreadsJson}`;

  console.log("[OpportunityAnalyzer] Analyzing spreads...");

  const finalMessage = await client.beta.messages.toolRunner({
    model: "claude-opus-4-6",
    max_tokens: 8192,
    thinking: { type: "adaptive" },
    system: systemPrompt,
    tools: [
      getFeeStructureTool,
      estimateSlippageTool,
      checkLiquidityTool,
      calculateNetProfitTool,
      analyzeOpportunityTool,
      rankOpportunitiesTool,
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = finalMessage.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n");

  console.log("[OpportunityAnalyzer] Result:\n", text);
  return [];
}

// Run standalone with demo data
if (process.argv[1]?.endsWith("opportunity-analyzer.ts")) {
  const demoSpreads: ArbitrageSpread[] = [
    {
      symbol: "BTC/USDT",
      buyExchange: "binance",
      sellExchange: "coinbase",
      buyPrice: 65000,
      sellPrice: 65350,
      spreadPct: 0.538,
      timestamp: Date.now(),
    },
    {
      symbol: "ETH/USDT",
      buyExchange: "kraken",
      sellExchange: "okx",
      buyPrice: 3500,
      sellPrice: 3512,
      spreadPct: 0.343,
      timestamp: Date.now(),
    },
  ];
  await runOpportunityAnalyzer(demoSpreads);
}
