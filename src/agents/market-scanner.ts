/**
 * Market Scanner Agent
 *
 * Monitors multiple crypto exchanges in real-time, identifies price
 * discrepancies across trading pairs, and surfaces arbitrage spreads
 * above a configurable threshold.
 */

import Anthropic from "@anthropic-ai/sdk";
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
// Tool definitions (raw JSON schema)
// ---------------------------------------------------------------------------

const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_exchanges",
    description: "Return the list of exchanges currently monitored by the scanner.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_pairs",
    description: "Return all trading pairs the scanner tracks across exchanges.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_ticker",
    description: "Fetch the latest bid/ask/last price for a symbol on a specific exchange.",
    input_schema: {
      type: "object",
      properties: {
        exchange: { type: "string", enum: ["binance", "coinbase", "kraken", "okx", "bybit"], description: "Exchange to query" },
        symbol:   { type: "string", description: 'Trading pair, e.g. "BTC/USDT"' },
      },
      required: ["exchange", "symbol"],
    },
  },
  {
    name: "scan_all_exchanges",
    description: "Fetch prices for a symbol across ALL monitored exchanges simultaneously and return each exchange's bid/ask.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: 'Trading pair to scan, e.g. "ETH/USDT"' },
      },
      required: ["symbol"],
    },
  },
  {
    name: "find_spreads",
    description: "Given price ticks from multiple exchanges, identify all cross-exchange buy-low/sell-high opportunities whose spread exceeds the minimum threshold.",
    input_schema: {
      type: "object",
      properties: {
        ticks: {
          type: "array",
          description: "Price ticks from scan_all_exchanges",
          items: {
            type: "object",
            properties: {
              exchange:  { type: "string" },
              symbol:    { type: "string" },
              bid:       { type: "number" },
              ask:       { type: "number" },
              last:      { type: "number" },
              volume24h: { type: "number" },
              timestamp: { type: "number" },
            },
          },
        },
        minSpreadPct: { type: "number", description: "Minimum spread % to report (default 0.2%)" },
      },
      required: ["ticks"],
    },
  },
  {
    name: "scan_all_pairs",
    description: "Run a full market scan across every tracked pair and every exchange, returning a ranked list of the best arbitrage spreads found.",
    input_schema: {
      type: "object",
      properties: {
        minSpreadPct: { type: "number", description: "Minimum spread % to include (default 0.2%)" },
        topN:         { type: "number", description: "Maximum number of top opportunities to return (default 10)" },
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
    case "list_exchanges":
      return JSON.stringify({ exchanges: EXCHANGES });

    case "list_pairs":
      return JSON.stringify({ pairs: SUPPORTED_PAIRS });

    case "get_ticker": {
      const tick = simulateTicker(input.exchange as Exchange, input.symbol as string);
      return JSON.stringify(tick);
    }

    case "scan_all_exchanges": {
      const ticks = EXCHANGES.map((ex) => simulateTicker(ex, input.symbol as string));
      return JSON.stringify({ symbol: input.symbol, ticks });
    }

    case "find_spreads": {
      const ticks = input.ticks as PriceTick[];
      const minSpreadPct = (input.minSpreadPct as number) ?? 0.2;
      const spreads: ArbitrageSpread[] = [];
      for (let i = 0; i < ticks.length; i++) {
        for (let j = 0; j < ticks.length; j++) {
          if (i === j) continue;
          const buyTick  = ticks[i]!;
          const sellTick = ticks[j]!;
          const spreadPct = ((sellTick.bid - buyTick.ask) / buyTick.ask) * 100;
          if (spreadPct >= minSpreadPct) {
            spreads.push({
              symbol:       buyTick.symbol,
              buyExchange:  buyTick.exchange  as Exchange,
              sellExchange: sellTick.exchange as Exchange,
              buyPrice:     buyTick.ask,
              sellPrice:    sellTick.bid,
              spreadPct,
              timestamp:    Date.now(),
            });
          }
        }
      }
      spreads.sort((a, b) => b.spreadPct - a.spreadPct);
      return JSON.stringify({ spreads, count: spreads.length });
    }

    case "scan_all_pairs": {
      const minSpreadPct = (input.minSpreadPct as number) ?? 0.2;
      const topN         = (input.topN as number) ?? 10;
      const allSpreads: ArbitrageSpread[] = [];
      for (const symbol of SUPPORTED_PAIRS) {
        const ticks = EXCHANGES.map((ex) => simulateTicker(ex, symbol));
        for (let i = 0; i < ticks.length; i++) {
          for (let j = 0; j < ticks.length; j++) {
            if (i === j) continue;
            const buyTick  = ticks[i]!;
            const sellTick = ticks[j]!;
            const spreadPct = ((sellTick.bid - buyTick.ask) / buyTick.ask) * 100;
            if (spreadPct >= minSpreadPct) {
              allSpreads.push({
                symbol,
                buyExchange:  buyTick.exchange  as Exchange,
                sellExchange: sellTick.exchange as Exchange,
                buyPrice:     buyTick.ask,
                sellPrice:    sellTick.bid,
                spreadPct,
                timestamp:    Date.now(),
              });
            }
          }
        }
      }
      allSpreads.sort((a, b) => b.spreadPct - a.spreadPct);
      return JSON.stringify({ spreads: allSpreads.slice(0, topN), totalFound: allSpreads.length });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

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

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userPrompt },
  ];

  // Manual agentic loop
  while (true) {
    const response = await client.messages.create({
      model:      "claude-opus-4-6",
      max_tokens: 4096,
      thinking:   { type: "adaptive" },
      system:     systemPrompt,
      tools:      TOOLS,
      messages,
    });

    // Append assistant turn
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      console.log("[MarketScanner] Result:\n", text);
      break;
    }

    // Execute tool calls and feed results back
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

// Run standalone
if (process.argv[1]?.endsWith("market-scanner.ts")) {
  await runMarketScanner();
}
