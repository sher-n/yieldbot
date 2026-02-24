/**
 * Market Scanner Agent
 *
 * Monitors multiple crypto exchanges in real-time, identifies price
 * discrepancies across trading pairs, and surfaces arbitrage spreads
 * above a configurable threshold.
 */

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import {
  type Exchange,
  type PriceTick,
  type ArbitrageSpread,
  EXCHANGES,
  SUPPORTED_PAIRS,
} from "../types.js";

const client = new Anthropic();

// ---------------------------------------------------------------------------
// Mock exchange data layer (replace with real exchange API calls)
// ---------------------------------------------------------------------------

function mockPrice(base: number, volatility = 0.003): number {
  return base * (1 + (Math.random() - 0.5) * volatility);
}

const BASE_PRICES: Record<string, number> = {
  "BTC/USDT":   65000,
  "ETH/USDT":   3500,
  "SOL/USDT":   145,
  "BNB/USDT":   580,
  "XRP/USDT":   0.52,
  "ADA/USDT":   0.43,
  "AVAX/USDT":  35,
  "MATIC/USDT": 0.72,
};

function simulateTicker(exchange: Exchange, symbol: string): PriceTick {
  const base = BASE_PRICES[symbol] ?? 1;
  // Each exchange gets a slight bias to simulate real spreads
  const exchangeBias: Record<Exchange, number> = {
    binance:  1.000,
    coinbase: 1.002,
    kraken:   0.999,
    okx:      1.001,
    bybit:    0.998,
  };
  const mid = mockPrice(base * exchangeBias[exchange]);
  return {
    exchange,
    symbol,
    bid: mid * 0.9995,
    ask: mid * 1.0005,
    last: mid,
    volume24h: Math.random() * 1_000_000,
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const listExchangesTool = betaZodTool({
  name: "list_exchanges",
  description: "Return the list of exchanges currently monitored by the scanner.",
  inputSchema: z.object({}),
  run: async () => {
    return JSON.stringify({ exchanges: EXCHANGES });
  },
});

const listPairsTool = betaZodTool({
  name: "list_pairs",
  description: "Return all trading pairs the scanner tracks across exchanges.",
  inputSchema: z.object({}),
  run: async () => {
    return JSON.stringify({ pairs: SUPPORTED_PAIRS });
  },
});

const getTickerTool = betaZodTool({
  name: "get_ticker",
  description: "Fetch the latest bid/ask/last price for a symbol on a specific exchange.",
  inputSchema: z.object({
    exchange: z
      .enum(["binance", "coinbase", "kraken", "okx", "bybit"])
      .describe("Exchange to query"),
    symbol: z
      .string()
      .describe('Trading pair, e.g. "BTC/USDT"'),
  }),
  run: async ({ exchange, symbol }) => {
    const tick = simulateTicker(exchange as Exchange, symbol);
    return JSON.stringify(tick);
  },
});

const scanAllExchangesTool = betaZodTool({
  name: "scan_all_exchanges",
  description:
    "Fetch prices for a symbol across ALL monitored exchanges simultaneously " +
    "and return each exchange's bid/ask so spreads can be computed.",
  inputSchema: z.object({
    symbol: z.string().describe('Trading pair to scan, e.g. "ETH/USDT"'),
  }),
  run: async ({ symbol }) => {
    const ticks: PriceTick[] = EXCHANGES.map((ex) =>
      simulateTicker(ex, symbol)
    );
    return JSON.stringify({ symbol, ticks });
  },
});

const findSpreadsTool = betaZodTool({
  name: "find_spreads",
  description:
    "Given price ticks from multiple exchanges, identify all cross-exchange " +
    "buy-low/sell-high opportunities whose spread exceeds the minimum threshold.",
  inputSchema: z.object({
    ticks: z
      .array(
        z.object({
          exchange: z.string(),
          symbol: z.string(),
          bid: z.number(),
          ask: z.number(),
          last: z.number(),
          volume24h: z.number(),
          timestamp: z.number(),
        })
      )
      .describe("Price ticks from scan_all_exchanges"),
    minSpreadPct: z
      .number()
      .default(0.2)
      .describe("Minimum spread % to report (default 0.2%)"),
  }),
  run: async ({ ticks, minSpreadPct }) => {
    const spreads: ArbitrageSpread[] = [];

    for (let i = 0; i < ticks.length; i++) {
      for (let j = 0; j < ticks.length; j++) {
        if (i === j) continue;
        const buyTick = ticks[i];   // buy at ask
        const sellTick = ticks[j];  // sell at bid
        if (!buyTick || !sellTick) continue;

        const spreadPct =
          ((sellTick.bid - buyTick.ask) / buyTick.ask) * 100;

        if (spreadPct >= minSpreadPct) {
          spreads.push({
            symbol: buyTick.symbol,
            buyExchange:  buyTick.exchange  as Exchange,
            sellExchange: sellTick.exchange as Exchange,
            buyPrice:  buyTick.ask,
            sellPrice: sellTick.bid,
            spreadPct,
            timestamp: Date.now(),
          });
        }
      }
    }

    spreads.sort((a, b) => b.spreadPct - a.spreadPct);
    return JSON.stringify({ spreads, count: spreads.length });
  },
});

const scanAllPairsTool = betaZodTool({
  name: "scan_all_pairs",
  description:
    "Run a full market scan across every tracked pair and every exchange, " +
    "returning a ranked list of the best arbitrage spreads found.",
  inputSchema: z.object({
    minSpreadPct: z
      .number()
      .default(0.2)
      .describe("Minimum spread % to include in results"),
    topN: z
      .number()
      .default(10)
      .describe("Maximum number of top opportunities to return"),
  }),
  run: async ({ minSpreadPct, topN }) => {
    const allSpreads: ArbitrageSpread[] = [];

    for (const symbol of SUPPORTED_PAIRS) {
      const ticks = EXCHANGES.map((ex) => simulateTicker(ex, symbol));

      for (let i = 0; i < ticks.length; i++) {
        for (let j = 0; j < ticks.length; j++) {
          if (i === j) continue;
          const buyTick = ticks[i];
          const sellTick = ticks[j];
          if (!buyTick || !sellTick) continue;
          const spreadPct =
            ((sellTick.bid - buyTick.ask) / buyTick.ask) * 100;
          if (spreadPct >= minSpreadPct) {
            allSpreads.push({
              symbol,
              buyExchange:  buyTick.exchange  as Exchange,
              sellExchange: sellTick.exchange as Exchange,
              buyPrice:  buyTick.ask,
              sellPrice: sellTick.bid,
              spreadPct,
              timestamp: Date.now(),
            });
          }
        }
      }
    }

    allSpreads.sort((a, b) => b.spreadPct - a.spreadPct);
    const top = allSpreads.slice(0, topN);
    return JSON.stringify({ spreads: top, totalFound: allSpreads.length });
  },
});

// ---------------------------------------------------------------------------
// Agent runner
// ---------------------------------------------------------------------------

export async function runMarketScanner(prompt?: string): Promise<ArbitrageSpread[]> {
  const systemPrompt = `You are the Market Scanner Agent for a crypto arbitrage system.

Your job is to:
1. Scan all supported exchanges and trading pairs for price discrepancies
2. Identify cross-exchange arbitrage spreads above the minimum threshold (0.2%)
3. Return a ranked list of the best opportunities found, sorted by spread %

Always use scan_all_pairs for a comprehensive sweep, then summarize the top findings.
Report the symbol, buy exchange, sell exchange, prices, and spread % for each opportunity.`;

  const userPrompt =
    prompt ??
    "Perform a full market scan across all exchanges and pairs. " +
    "Find and rank the top arbitrage spread opportunities available right now.";

  console.log("[MarketScanner] Starting scan...");

  const finalMessage = await client.beta.messages.toolRunner({
    model: "claude-opus-4-6",
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system: systemPrompt,
    tools: [
      listExchangesTool,
      listPairsTool,
      getTickerTool,
      scanAllExchangesTool,
      findSpreadsTool,
      scanAllPairsTool,
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  // Extract the text summary
  const text = finalMessage.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n");

  console.log("[MarketScanner] Result:\n", text);

  // Return spreads from the last tool call for downstream agents
  // (in production, parse from structured output)
  return [];
}

// Run standalone
if (process.argv[1]?.endsWith("market-scanner.ts")) {
  await runMarketScanner();
}
