/**
 * Trade Executor Agent
 *
 * Receives viable arbitrage opportunities from the Opportunity Analyzer and
 * executes the simultaneous buy/sell legs. Monitors fills, handles partial
 * fills, and records final trade results.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  type Exchange,
  type ArbitrageOpportunity,
  type Order,
  type TradeResult,
} from "../types.js";

const client = new Anthropic();

// ---------------------------------------------------------------------------
// In-memory order store
// ---------------------------------------------------------------------------

const orderStore = new Map<string, Order>();
let orderIdCounter = 1;

function simulateOrderFill(order: Order): Order {
  const fillRatio = Math.random() > 0.1 ? 1.0 : 0.5 + Math.random() * 0.4;
  const slippage  = (Math.random() - 0.5) * 0.0002;
  return {
    ...order,
    status:       fillRatio >= 1.0 ? "filled" : "partial",
    filledAmount: order.amount * fillRatio,
    avgFillPrice: (order.price ?? order.amount) * (1 + slippage),
  };
}

// ---------------------------------------------------------------------------
// Tool definitions (raw JSON schema)
// ---------------------------------------------------------------------------

const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_balance",
    description: "Check the available balance of a currency on a specific exchange.",
    input_schema: {
      type: "object",
      properties: {
        exchange: { type: "string", enum: ["binance", "coinbase", "kraken", "okx", "bybit"] },
        currency: { type: "string", description: 'e.g. "USDT", "BTC"' },
      },
      required: ["exchange", "currency"],
    },
  },
  {
    name: "place_order",
    description: "Submit a market or limit order to an exchange. Returns an order object with a unique ID.",
    input_schema: {
      type: "object",
      properties: {
        exchange:  { type: "string", enum: ["binance", "coinbase", "kraken", "okx", "bybit"] },
        symbol:    { type: "string" },
        side:      { type: "string", enum: ["buy", "sell"] },
        orderType: { type: "string", enum: ["market", "limit"] },
        amount:    { type: "number", description: "Amount of base currency" },
        price:     { type: "number", description: "Limit price (required for limit orders)" },
      },
      required: ["exchange", "symbol", "side", "orderType", "amount"],
    },
  },
  {
    name: "check_order_status",
    description: "Retrieve the current status and fill details for a placed order.",
    input_schema: {
      type: "object",
      properties: {
        exchange: { type: "string", enum: ["binance", "coinbase", "kraken", "okx", "bybit"] },
        orderId:  { type: "string" },
      },
      required: ["exchange", "orderId"],
    },
  },
  {
    name: "cancel_order",
    description: "Cancel an open or partially filled order.",
    input_schema: {
      type: "object",
      properties: {
        exchange: { type: "string", enum: ["binance", "coinbase", "kraken", "okx", "bybit"] },
        orderId:  { type: "string" },
      },
      required: ["exchange", "orderId"],
    },
  },
  {
    name: "execute_arbitrage",
    description: "Execute both legs of an arbitrage trade simultaneously: buy on cheap exchange, sell on expensive exchange.",
    input_schema: {
      type: "object",
      properties: {
        opportunityId:  { type: "string" },
        symbol:         { type: "string" },
        buyExchange:    { type: "string", enum: ["binance", "coinbase", "kraken", "okx", "bybit"] },
        sellExchange:   { type: "string", enum: ["binance", "coinbase", "kraken", "okx", "bybit"] },
        buyPrice:       { type: "number" },
        sellPrice:      { type: "number" },
        tradeAmountUSD: { type: "number" },
      },
      required: ["opportunityId", "symbol", "buyExchange", "sellExchange", "buyPrice", "sellPrice", "tradeAmountUSD"],
    },
  },
  {
    name: "get_trade_history",
    description: "Return the list of all orders placed in the current session.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum orders to return (default 20)" },
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
    case "get_balance": {
      const balances: Record<string, Record<string, number>> = {
        binance:  { USDT: 50_000, BTC: 0.5,  ETH: 5.0 },
        coinbase: { USDT: 30_000, BTC: 0.3,  ETH: 3.0 },
        kraken:   { USDT: 25_000, BTC: 0.25, ETH: 2.5 },
        okx:      { USDT: 40_000, BTC: 0.4,  ETH: 4.0 },
        bybit:    { USDT: 35_000, BTC: 0.35, ETH: 3.5 },
      };
      return JSON.stringify({
        exchange:  input.exchange,
        currency:  input.currency,
        available: balances[input.exchange as string]?.[input.currency as string] ?? 0,
      });
    }

    case "place_order": {
      const orderId = `ORD-${String(orderIdCounter++).padStart(6, "0")}`;
      const order: Order = {
        id:           orderId,
        exchange:     input.exchange as Exchange,
        symbol:       input.symbol   as string,
        side:         input.side     as "buy" | "sell",
        type:         input.orderType as "market" | "limit",
        amount:       input.amount   as number,
        price:        input.price    as number | undefined,
        status:       "open",
        filledAmount: 0,
        avgFillPrice: 0,
        timestamp:    Date.now(),
      };
      orderStore.set(orderId, order);
      console.log(`[TradeExecutor] Placed: ${orderId} | ${order.side} ${order.amount} ${order.symbol} on ${order.exchange}`);
      return JSON.stringify({ success: true, order });
    }

    case "check_order_status": {
      const order = orderStore.get(input.orderId as string);
      if (!order) return JSON.stringify({ error: `Order ${input.orderId} not found` });
      if (order.status === "open") {
        const filled = simulateOrderFill(order);
        orderStore.set(order.id, filled);
        return JSON.stringify(filled);
      }
      return JSON.stringify(order);
    }

    case "cancel_order": {
      const order = orderStore.get(input.orderId as string);
      if (!order) return JSON.stringify({ error: `Order ${input.orderId} not found` });
      if (order.status === "filled") return JSON.stringify({ error: "Cannot cancel a filled order" });
      const cancelled = { ...order, status: "cancelled" as const };
      orderStore.set(order.id, cancelled);
      return JSON.stringify({ success: true, order: cancelled });
    }

    case "execute_arbitrage": {
      const { opportunityId, symbol, buyExchange, sellExchange, buyPrice, sellPrice, tradeAmountUSD } =
        input as Record<string, string | number>;
      const baseAmount = (tradeAmountUSD as number) / (buyPrice as number);

      const buyId  = `ORD-${String(orderIdCounter++).padStart(6, "0")}`;
      const sellId = `ORD-${String(orderIdCounter++).padStart(6, "0")}`;

      const buyOrder: Order  = { id: buyId,  exchange: buyExchange  as Exchange, symbol: symbol as string, side: "buy",  type: "market", amount: baseAmount, price: buyPrice  as number, status: "open", filledAmount: 0, avgFillPrice: 0, timestamp: Date.now() };
      const sellOrder: Order = { id: sellId, exchange: sellExchange as Exchange, symbol: symbol as string, side: "sell", type: "market", amount: baseAmount, price: sellPrice as number, status: "open", filledAmount: 0, avgFillPrice: 0, timestamp: Date.now() };

      const filledBuy  = simulateOrderFill(buyOrder);
      const filledSell = simulateOrderFill(sellOrder);
      orderStore.set(buyId,  filledBuy);
      orderStore.set(sellId, filledSell);

      const profit    = (filledSell.filledAmount * filledSell.avgFillPrice) - (filledBuy.filledAmount * filledBuy.avgFillPrice);
      const profitPct = (profit / (filledBuy.filledAmount * filledBuy.avgFillPrice)) * 100;
      const status    = filledBuy.status === "filled" && filledSell.status === "filled" ? "success"
                      : filledBuy.status === "partial" || filledSell.status === "partial" ? "partial"
                      : "failed";

      const result: TradeResult = {
        opportunityId: opportunityId as string,
        buyOrder:         filledBuy,
        sellOrder:        filledSell,
        actualProfitUSD:  profit,
        actualProfitPct:  profitPct,
        status,
      };
      console.log(`[TradeExecutor] Trade ${opportunityId} | ${status} | Profit: $${profit.toFixed(2)} (${profitPct.toFixed(4)}%)`);
      return JSON.stringify(result);
    }

    case "get_trade_history": {
      const limit  = (input.limit as number) ?? 20;
      const orders = [...orderStore.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
      return JSON.stringify({ orders, total: orderStore.size });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

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
Never execute a trade if balance checks fail.`;

  const userPrompt =
    `Execute the following viable arbitrage opportunities in order of priority. ` +
    `Verify balances, execute trades, check fills, and report results.\n\n` +
    `Opportunities:\n${JSON.stringify(opportunities.slice(0, 10))}`;

  console.log(`[TradeExecutor] Executing ${opportunities.length} opportunity(ies)...`);

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
      console.log("[TradeExecutor] Result:\n", text);
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

// Run standalone
if (process.argv[1]?.endsWith("trade-executor.ts")) {
  const demo: ArbitrageOpportunity = {
    id: "OPP-001",
    spread: { symbol: "BTC/USDT", buyExchange: "binance", sellExchange: "coinbase", buyPrice: 65000, sellPrice: 65390, spreadPct: 0.6, timestamp: Date.now() },
    grossProfitPct: 0.6, netProfitPct: 0.21, estimatedProfitUSD: 21,
    requiredCapitalUSD: 10_000, buyFee: 0.001, sellFee: 0.006, slippagePct: 0.11, viable: true,
  };
  await runTradeExecutor([demo]);
}
