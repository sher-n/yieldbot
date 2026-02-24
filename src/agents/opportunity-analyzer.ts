/**
 * Opportunity Analyzer Agent
 *
 * Takes raw price spreads from the Market Scanner and evaluates each one for
 * true profitability by accounting for trading fees, estimated slippage, and
 * minimum capital requirements. Outputs only viable opportunities.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  type Exchange,
  type ArbitrageSpread,
  type ArbitrageOpportunity,
  FEE_TABLE,
} from "../types.js";

const client = new Anthropic();

// ---------------------------------------------------------------------------
// Tool definitions (raw JSON schema)
// ---------------------------------------------------------------------------

const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_fee_structure",
    description: "Return the maker and taker fee rates for a given exchange. Arbitrage trades are typically taker orders.",
    input_schema: {
      type: "object",
      properties: {
        exchange: { type: "string", enum: ["binance", "coinbase", "kraken", "okx", "bybit"] },
      },
      required: ["exchange"],
    },
  },
  {
    name: "estimate_slippage",
    description: "Estimate slippage for a market order. Returns slippage as a decimal fraction (e.g. 0.001 = 0.1%).",
    input_schema: {
      type: "object",
      properties: {
        exchange:        { type: "string", enum: ["binance", "coinbase", "kraken", "okx", "bybit"] },
        symbol:          { type: "string" },
        tradeAmountUSD:  { type: "number", description: "Size of the order in USD" },
      },
      required: ["exchange", "symbol", "tradeAmountUSD"],
    },
  },
  {
    name: "check_liquidity",
    description: "Verify whether an exchange has sufficient order book depth to fill a trade without excessive slippage.",
    input_schema: {
      type: "object",
      properties: {
        exchange:       { type: "string", enum: ["binance", "coinbase", "kraken", "okx", "bybit"] },
        symbol:         { type: "string" },
        tradeAmountUSD: { type: "number" },
      },
      required: ["exchange", "symbol", "tradeAmountUSD"],
    },
  },
  {
    name: "calculate_net_profit",
    description: "Compute the net profit of an arbitrage trade after fees and slippage.",
    input_schema: {
      type: "object",
      properties: {
        buyPrice:       { type: "number" },
        sellPrice:      { type: "number" },
        buyFeePct:      { type: "number", description: "Taker fee on buy exchange (decimal)" },
        sellFeePct:     { type: "number", description: "Taker fee on sell exchange (decimal)" },
        buySlippage:    { type: "number", description: "Buy-side slippage (decimal)" },
        sellSlippage:   { type: "number", description: "Sell-side slippage (decimal)" },
        tradeAmountUSD: { type: "number" },
      },
      required: ["buyPrice", "sellPrice", "buyFeePct", "sellFeePct", "buySlippage", "sellSlippage", "tradeAmountUSD"],
    },
  },
  {
    name: "analyze_opportunity",
    description: "Run a full profitability analysis on a single arbitrage spread, combining fees, slippage, and liquidity checks.",
    input_schema: {
      type: "object",
      properties: {
        opportunityId:  { type: "string" },
        symbol:         { type: "string" },
        buyExchange:    { type: "string", enum: ["binance", "coinbase", "kraken", "okx", "bybit"] },
        sellExchange:   { type: "string", enum: ["binance", "coinbase", "kraken", "okx", "bybit"] },
        buyPrice:       { type: "number" },
        sellPrice:      { type: "number" },
        spreadPct:      { type: "number" },
        tradeAmountUSD: { type: "number", description: "Capital to deploy in USD (default 10000)" },
      },
      required: ["opportunityId", "symbol", "buyExchange", "sellExchange", "buyPrice", "sellPrice", "spreadPct"],
    },
  },
  {
    name: "rank_opportunities",
    description: "Filter to only viable opportunities and sort them by estimated net profit USD descending.",
    input_schema: {
      type: "object",
      properties: {
        opportunities: { type: "array", items: { type: "object" }, description: "Array of ArbitrageOpportunity objects" },
      },
      required: ["opportunities"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

type ToolInput = Record<string, unknown>;

const BASE_SLIPPAGE: Record<Exchange, number> = {
  binance:  0.0003,
  coinbase: 0.0008,
  kraken:   0.0006,
  okx:      0.0004,
  bybit:    0.0005,
};

const MAX_LIQUIDITY: Record<Exchange, number> = {
  binance:  250_000,
  coinbase: 100_000,
  kraken:    75_000,
  okx:      150_000,
  bybit:    125_000,
};

async function handleTool(name: string, input: ToolInput): Promise<string> {
  switch (name) {
    case "get_fee_structure":
      return JSON.stringify(FEE_TABLE[input.exchange as Exchange]);

    case "estimate_slippage": {
      const base    = BASE_SLIPPAGE[input.exchange as Exchange] ?? 0.001;
      const size    = input.tradeAmountUSD as number;
      const slippage = base + Math.max(0, (size - 1000) / 10000) * 0.0001;
      return JSON.stringify({ exchange: input.exchange, slippage, slippagePct: slippage * 100 });
    }

    case "check_liquidity": {
      const cap       = MAX_LIQUIDITY[input.exchange as Exchange] ?? 50_000;
      const size      = input.tradeAmountUSD as number;
      const sufficient = size <= cap;
      return JSON.stringify({ exchange: input.exchange, tradeAmountUSD: size, maxRecommendedUSD: cap, sufficient });
    }

    case "calculate_net_profit": {
      const { buyPrice, sellPrice, buyFeePct, sellFeePct, buySlippage, sellSlippage, tradeAmountUSD } =
        input as Record<string, number>;
      const effectiveBuy  = buyPrice  * (1 + buySlippage)  * (1 + buyFeePct);
      const effectiveSell = sellPrice * (1 - sellSlippage) * (1 - sellFeePct);
      const grossProfitPct = ((sellPrice - buyPrice) / buyPrice) * 100;
      const netProfitPct   = ((effectiveSell - effectiveBuy) / effectiveBuy) * 100;
      return JSON.stringify({
        grossProfitPct,
        netProfitPct,
        netProfitUSD:    (netProfitPct / 100) * tradeAmountUSD,
        totalFeesPct:    (buyFeePct + sellFeePct) * 100,
        totalSlippagePct:(buySlippage + sellSlippage) * 100,
        viable:          netProfitPct > 0,
      });
    }

    case "analyze_opportunity": {
      const {
        opportunityId, symbol, buyExchange, sellExchange,
        buyPrice, sellPrice, spreadPct,
      } = input as Record<string, string | number>;
      const tradeAmountUSD = (input.tradeAmountUSD as number) ?? 10_000;

      const buyFees   = FEE_TABLE[buyExchange  as Exchange];
      const sellFees  = FEE_TABLE[sellExchange as Exchange];
      const buySlip   = BASE_SLIPPAGE[buyExchange  as Exchange] ?? 0.001;
      const sellSlip  = BASE_SLIPPAGE[sellExchange as Exchange] ?? 0.001;
      const liquidityOk =
        tradeAmountUSD <= MAX_LIQUIDITY[buyExchange  as Exchange] &&
        tradeAmountUSD <= MAX_LIQUIDITY[sellExchange as Exchange];

      const effectiveBuy  = (buyPrice  as number) * (1 + buySlip)  * (1 + buyFees.taker);
      const effectiveSell = (sellPrice as number) * (1 - sellSlip) * (1 - sellFees.taker);
      const netProfitPct  = ((effectiveSell - effectiveBuy) / effectiveBuy) * 100;
      const netProfitUSD  = (netProfitPct / 100) * tradeAmountUSD;
      const viable = netProfitPct > 0.05 && liquidityOk;

      const opportunity: ArbitrageOpportunity = {
        id: opportunityId as string,
        spread: {
          symbol:       symbol as string,
          buyExchange:  buyExchange  as Exchange,
          sellExchange: sellExchange as Exchange,
          buyPrice:     buyPrice  as number,
          sellPrice:    sellPrice as number,
          spreadPct:    spreadPct as number,
          timestamp:    Date.now(),
        },
        grossProfitPct:    spreadPct as number,
        netProfitPct,
        estimatedProfitUSD: netProfitUSD,
        requiredCapitalUSD: tradeAmountUSD,
        buyFee:   buyFees.taker,
        sellFee:  sellFees.taker,
        slippagePct: (buySlip + sellSlip) * 100,
        viable,
        reason: !liquidityOk
          ? "Insufficient liquidity for requested trade size"
          : netProfitPct <= 0.05
          ? `Net profit ${netProfitPct.toFixed(4)}% below 0.05% minimum after fees & slippage`
          : undefined,
      };
      return JSON.stringify(opportunity);
    }

    case "rank_opportunities": {
      const opps = input.opportunities as ArbitrageOpportunity[];
      const viable = opps
        .filter((o) => o.viable)
        .sort((a, b) => b.estimatedProfitUSD - a.estimatedProfitUSD);
      return JSON.stringify({ viable, viableCount: viable.length, totalAnalyzed: opps.length });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

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

Be conservative — only recommend trades with a clear edge after all costs.
Use analyze_opportunity for efficiency when you have all required data.`;

  const userPrompt =
    `Analyze the following arbitrage spreads and determine which are truly profitable ` +
    `after fees and slippage. Trade size = $${tradeAmountUSD.toLocaleString()} per trade.\n\n` +
    `Spreads:\n${JSON.stringify(spreads.slice(0, 20))}`;

  console.log("[OpportunityAnalyzer] Analyzing spreads...");

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
      console.log("[OpportunityAnalyzer] Result:\n", text);
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

  return [];
}

// Run standalone with demo data
if (process.argv[1]?.endsWith("opportunity-analyzer.ts")) {
  const demoSpreads: ArbitrageSpread[] = [
    { symbol: "BTC/USDT", buyExchange: "binance",  sellExchange: "coinbase", buyPrice: 65000, sellPrice: 65350, spreadPct: 0.538, timestamp: Date.now() },
    { symbol: "ETH/USDT", buyExchange: "kraken",   sellExchange: "okx",      buyPrice: 3500,  sellPrice: 3512,  spreadPct: 0.343, timestamp: Date.now() },
  ];
  await runOpportunityAnalyzer(demoSpreads);
}
