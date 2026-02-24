// Shared types for the crypto arbitrage agent framework

export type Exchange = "binance" | "coinbase" | "kraken" | "okx" | "bybit";

export interface PriceTick {
  exchange: Exchange;
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  volume24h: number;
  timestamp: number;
}

export interface ArbitrageSpread {
  symbol: string;
  buyExchange: Exchange;
  sellExchange: Exchange;
  buyPrice: number;
  sellPrice: number;
  spreadPct: number;
  timestamp: number;
}

export interface FeeStructure {
  exchange: Exchange;
  maker: number;
  taker: number;
}

export interface ArbitrageOpportunity {
  id: string;
  spread: ArbitrageSpread;
  grossProfitPct: number;
  netProfitPct: number;
  estimatedProfitUSD: number;
  requiredCapitalUSD: number;
  buyFee: number;
  sellFee: number;
  slippagePct: number;
  viable: boolean;
  reason?: string;
}

export interface Order {
  id: string;
  exchange: Exchange;
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  amount: number;
  price?: number;
  status: "open" | "filled" | "partial" | "cancelled";
  filledAmount: number;
  avgFillPrice: number;
  timestamp: number;
}

export interface TradeResult {
  opportunityId: string;
  buyOrder: Order;
  sellOrder: Order;
  actualProfitUSD: number;
  actualProfitPct: number;
  status: "success" | "partial" | "failed";
  error?: string;
}

export interface Position {
  symbol: string;
  exchange: Exchange;
  side: "long" | "short";
  amount: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
}

export interface PortfolioSnapshot {
  totalValueUSD: number;
  availableCapitalUSD: number;
  openPositions: Position[];
  dailyPnlUSD: number;
  dailyPnlPct: number;
  maxDrawdownPct: number;
  winRate: number;
  tradeCount: number;
}

export interface RiskReport {
  timestamp: number;
  portfolio: PortfolioSnapshot;
  riskLevel: "low" | "medium" | "high" | "critical";
  alerts: string[];
  recommendations: string[];
}

export const SUPPORTED_PAIRS = [
  "BTC/USDT",
  "ETH/USDT",
  "SOL/USDT",
  "BNB/USDT",
  "XRP/USDT",
  "ADA/USDT",
  "AVAX/USDT",
  "MATIC/USDT",
] as const;

export const EXCHANGES: Exchange[] = [
  "binance",
  "coinbase",
  "kraken",
  "okx",
  "bybit",
];

export const FEE_TABLE: Record<Exchange, FeeStructure> = {
  binance:  { exchange: "binance",  maker: 0.001, taker: 0.001 },
  coinbase: { exchange: "coinbase", maker: 0.004, taker: 0.006 },
  kraken:   { exchange: "kraken",   maker: 0.0016, taker: 0.0026 },
  okx:      { exchange: "okx",      maker: 0.0008, taker: 0.001 },
  bybit:    { exchange: "bybit",    maker: 0.001, taker: 0.001 },
};
