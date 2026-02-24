/**
 * Trade Executor Agent
 *
 * Receives viable arbitrage opportunities from the Opportunity Analyzer and
 * executes the simultaneous buy/sell legs. Monitors fills, handles partial
 * fills, and records final trade results.
 */

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import {
  type Exchange,
  type ArbitrageOpportunity,
  type Order,
  type TradeResult,
} from "../types.js";

const client = new Anthropic();

// ---------------------------------------------------------------------------
// In-memory order store (replace with exchange API + DB in production)
// ---------------------------------------------------------------------------

const orderStore = new Map<string, Order>();
let orderIdCounter = 1;

function simulateOrderFill(order: Order): Order {
  // Simulate realistic fill: 90% chance of full fill, 10% partial
  const fillRatio = Math.random() > 0.1 ? 1.0 : 0.5 + Math.random() * 0.4;
  const slippage  = (Math.random() - 0.5) * 0.0002; // ±0.01%
  return {
    ...order,
    status:       fillRatio >= 1.0 ? "filled" : "partial",
    filledAmount: order.amount * fillRatio,
    avgFillPrice: order.price! * (1 + slippage),
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const getBalanceTool = betaZodTool({
  name: "get_balance",
  description:
    "Check the available balance of a currency on a specific exchange. " +
    "Used to verify sufficient funds before placing orders.",
  inputSchema: z.object({
    exchange: z.enum(["binance", "coinbase", "kraken", "okx", "bybit"]),
    currency: z.string().describe('Currency symbol, e.g. "USDT", "BTC"'),
  }),
  run: async ({ exchange, currency }) => {
    // Mock balances — replace with real exchange API calls
    const balances: Record<string, Record<string, number>> = {
      binance:  { USDT: 50_000, BTC: 0.5,  ETH: 5.0  },
      coinbase: { USDT: 30_000, BTC: 0.3,  ETH: 3.0  },
      kraken:   { USDT: 25_000, BTC: 0.25, ETH: 2.5  },
      okx:      { USDT: 40_000, BTC: 0.4,  ETH: 4.0  },
      bybit:    { USDT: 35_000, BTC: 0.35, ETH: 3.5  },
    };
    const balance = balances[exchange]?.[currency] ?? 0;
    return JSON.stringify({ exchange, currency, available: balance });
  },
});

const placeOrderTool = betaZodTool({
  name: "place_order",
  description:
    "Submit a market or limit order to an exchange. " +
    "Returns an order object with a unique order ID for tracking.",
  inputSchema: z.object({
    exchange:  z.enum(["binance", "coinbase", "kraken", "okx", "bybit"]),
    symbol:    z.string().describe('Trading pair, e.g. "BTC/USDT"'),
    side:      z.enum(["buy", "sell"]),
    orderType: z.enum(["market", "limit"]),
    amount:    z.number().describe("Amount of base currency to trade"),
    price:     z.number().optional().describe("Limit price (required for limit orders)"),
  }),
  run: async ({ exchange, symbol, side, orderType, amount, price }) => {
    const orderId = `ORD-${String(orderIdCounter++).padStart(6, "0")}`;
    const order: Order = {
      id:           orderId,
      exchange:     exchange as Exchange,
      symbol,
      side,
      type:         orderType,
      amount,
      price:        price ?? (side === "buy" ? amount * 1.001 : amount * 0.999),
      status:       "open",
      filledAmount: 0,
      avgFillPrice: 0,
      timestamp:    Date.now(),
    };
    orderStore.set(orderId, order);
    console.log(`[TradeExecutor] Order placed: ${orderId} | ${side} ${amount} ${symbol} on ${exchange}`);
    return JSON.stringify({ success: true, order });
  },
});

const checkOrderStatusTool = betaZodTool({
  name: "check_order_status",
  description:
    "Retrieve the current status and fill details for a placed order. " +
    "Call this after placing an order to confirm it was filled.",
  inputSchema: z.object({
    exchange: z.enum(["binance", "coinbase", "kraken", "okx", "bybit"]),
    orderId:  z.string().describe("Order ID returned by place_order"),
  }),
  run: async ({ orderId }) => {
    const order = orderStore.get(orderId);
    if (!order) {
      return JSON.stringify({ error: `Order ${orderId} not found` });
    }
    // Simulate fill on first status check
    if (order.status === "open") {
      const filled = simulateOrderFill(order);
      orderStore.set(orderId, filled);
      return JSON.stringify(filled);
    }
    return JSON.stringify(order);
  },
});

const cancelOrderTool = betaZodTool({
  name: "cancel_order",
  description:
    "Cancel an open or partially filled order. " +
    "Use this for risk management if a leg fails to fill.",
  inputSchema: z.object({
    exchange: z.enum(["binance", "coinbase", "kraken", "okx", "bybit"]),
    orderId:  z.string(),
  }),
  run: async ({ orderId }) => {
    const order = orderStore.get(orderId);
    if (!order) {
      return JSON.stringify({ error: `Order ${orderId} not found` });
    }
    if (order.status === "filled") {
      return JSON.stringify({ error: "Cannot cancel a fully filled order" });
    }
    const cancelled = { ...order, status: "cancelled" as const };
    orderStore.set(orderId, cancelled);
    return JSON.stringify({ success: true, order: cancelled });
  },
});

const executeArbitrageTool = betaZodTool({
  name: "execute_arbitrage",
  description:
    "Execute both legs of an arbitrage trade simultaneously: " +
    "buy on the cheap exchange and sell on the expensive exchange. " +
    "Returns a TradeResult with fill details and actual profit.",
  inputSchema: z.object({
    opportunityId: z.string(),
    symbol:        z.string(),
    buyExchange:   z.enum(["binance", "coinbase", "kraken", "okx", "bybit"]),
    sellExchange:  z.enum(["binance", "coinbase", "kraken", "okx", "bybit"]),
    buyPrice:      z.number(),
    sellPrice:     z.number(),
    tradeAmountUSD: z.number().describe("USD capital to deploy"),
  }),
  run: async ({
    opportunityId,
    symbol,
    buyExchange,
    sellExchange,
    buyPrice,
    sellPrice,
    tradeAmountUSD,
  }) => {
    const baseAmount = tradeAmountUSD / buyPrice;

    // Place both legs
    const buyOrderId  = `ORD-${String(orderIdCounter++).padStart(6, "0")}`;
    const sellOrderId = `ORD-${String(orderIdCounter++).padStart(6, "0")}`;

    const buyOrder: Order = {
      id:           buyOrderId,
      exchange:     buyExchange as Exchange,
      symbol,
      side:         "buy",
      type:         "market",
      amount:       baseAmount,
      price:        buyPrice,
      status:       "open",
      filledAmount: 0,
      avgFillPrice: 0,
      timestamp:    Date.now(),
    };

    const sellOrder: Order = {
      id:           sellOrderId,
      exchange:     sellExchange as Exchange,
      symbol,
      side:         "sell",
      type:         "market",
      amount:       baseAmount,
      price:        sellPrice,
      status:       "open",
      filledAmount: 0,
      avgFillPrice: 0,
      timestamp:    Date.now(),
    };

    orderStore.set(buyOrderId,  buyOrder);
    orderStore.set(sellOrderId, sellOrder);

    // Simulate fills
    const filledBuy  = simulateOrderFill(buyOrder);
    const filledSell = simulateOrderFill(sellOrder);
    orderStore.set(buyOrderId,  filledBuy);
    orderStore.set(sellOrderId, filledSell);

    // Calculate actual profit
    const buyTotal  = filledBuy.filledAmount  * filledBuy.avgFillPrice;
    const sellTotal = filledSell.filledAmount * filledSell.avgFillPrice;
    const profit    = sellTotal - buyTotal;
    const profitPct = (profit / buyTotal) * 100;

    const status =
      filledBuy.status  === "filled" && filledSell.status === "filled"
        ? "success"
        : filledBuy.status  === "partial" || filledSell.status === "partial"
        ? "partial"
        : "failed";

    const result: TradeResult = {
      opportunityId,
      buyOrder:         filledBuy,
      sellOrder:        filledSell,
      actualProfitUSD:  profit,
      actualProfitPct:  profitPct,
      status,
    };

    console.log(
      `[TradeExecutor] Trade ${opportunityId} | Status: ${status} | ` +
      `Profit: $${profit.toFixed(2)} (${profitPct.toFixed(4)}%)`
    );

    return JSON.stringify(result);
  },
});

const getTradeHistoryTool = betaZodTool({
  name: "get_trade_history",
  description:
    "Return the list of all orders placed in the current session, " +
    "useful for post-execution reconciliation.",
  inputSchema: z.object({
    limit: z
      .number()
      .default(20)
      .describe("Maximum number of orders to return"),
  }),
  run: async ({ limit }) => {
    const orders = [...orderStore.values()]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
    return JSON.stringify({ orders, total: orderStore.size });
  },
});

// ---------------------------------------------------------------------------
// Agent runner
// ---------------------------------------------------------------------------

export async function runTradeExecutor(
  opportunities: ArbitrageOpportunity[]
): Promise<TradeResult[]> {
  const systemPrompt = `You are the Trade Executor Agent for a crypto arbitrage system.

Your job is to:
1. Verify sufficient balance on both exchanges before executing each trade
2. Execute arbitrage trades using execute_arbitrage for efficiency
3. Monitor order fills via check_order_status
4. Cancel the opposing leg if one leg fails to fill (to avoid directional exposure)
5. Report the actual profit/loss achieved for each completed trade

Always prioritize the highest net profit opportunities first.
Never execute a trade if balance checks fail.
Log all outcomes clearly.`;

  const opportunitiesJson = JSON.stringify(opportunities.slice(0, 10));
  const userPrompt =
    `Execute the following viable arbitrage opportunities in order of priority. ` +
    `Verify balances, execute trades, check fills, and report results.\n\n` +
    `Opportunities:\n${opportunitiesJson}`;

  console.log(
    `[TradeExecutor] Executing ${opportunities.length} opportunity(ies)...`
  );

  const finalMessage = await client.beta.messages.toolRunner({
    model: "claude-opus-4-6",
    max_tokens: 8192,
    thinking: { type: "adaptive" },
    system: systemPrompt,
    tools: [
      getBalanceTool,
      placeOrderTool,
      checkOrderStatusTool,
      cancelOrderTool,
      executeArbitrageTool,
      getTradeHistoryTool,
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = finalMessage.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n");

  console.log("[TradeExecutor] Result:\n", text);
  return [];
}

// Run standalone with demo opportunity
if (process.argv[1]?.endsWith("trade-executor.ts")) {
  const demoOpportunity: ArbitrageOpportunity = {
    id: "OPP-001",
    spread: {
      symbol:       "BTC/USDT",
      buyExchange:  "binance",
      sellExchange: "coinbase",
      buyPrice:     65000,
      sellPrice:    65390,
      spreadPct:    0.6,
      timestamp:    Date.now(),
    },
    grossProfitPct:    0.6,
    netProfitPct:      0.21,
    estimatedProfitUSD: 21,
    requiredCapitalUSD: 10_000,
    buyFee:    0.001,
    sellFee:   0.006,
    slippagePct: 0.11,
    viable:    true,
  };
  await runTradeExecutor([demoOpportunity]);
}
