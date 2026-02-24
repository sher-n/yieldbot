// ─── API Client ───────────────────────────────────────────────────────────────

const BASE = "";  // proxied to :3001 in dev, same-origin in prod

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "POST" });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Summary {
  totalProfitUsd: number;
  tradeCount: number;
  successCount: number;
  winRate: number;
  avgProfitUsd: number;
  availableCapitalUsd: number;
  totalValueUsd: number;
  riskLevel: string;
}

export interface HourlyRow {
  hour: number;
  tradeCount: number;
  totalProfit: number;
  avgProfit: number;
}

export interface ExchangePair {
  buyExchange: string;
  sellExchange: string;
  tradeCount: number;
  avgNetProfitPct: number;
}

export interface SlippageRow {
  exchange: string;
  avgSlippageError: number;
  sampleCount: number;
}

export interface RiskSnapshot {
  id: number;
  riskLevel: string;
  totalValueUsd: number;
  availableCapitalUsd: number;
  dailyPnlUsd: number;
  dailyPnlPct: number;
  maxDrawdownPct: number;
  winRate: number;
  tradeCount: number;
  alerts: string[];
  reportedAt: number;
}

export interface RiskData {
  latest: RiskSnapshot | null;
  history: RiskSnapshot[];
}

export interface Spread {
  id: number;
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  spreadPct: number;
  scannedAt: number;
}

export interface Opportunity {
  id: string;
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  spreadPct: number;
  netProfitPct: number;
  estimatedProfitUsd: number;
  requiredCapitalUsd: number;
  viable: number;
  reason: string | null;
  analyzedAt: number;
}

export interface Trade {
  id: number;
  opportunityId: string;
  buyOrderId: string;
  sellOrderId: string;
  estimatedProfitUsd: number;
  actualProfitUsd: number;
  actualProfitPct: number;
  slippageErrorPct: number;
  status: "success" | "partial" | "failed";
  executedAt: number;
}

export interface PriceTick {
  exchange: string;
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  volume24h: number;
  scanned_at: number;
}

// ─── API Functions ────────────────────────────────────────────────────────────

export const api = {
  summary:       () => get<Summary>("/api/summary"),
  hourly:        () => get<HourlyRow[]>("/api/hourly"),
  exchangePairs: () => get<ExchangePair[]>("/api/exchange-pairs"),
  slippage:      () => get<SlippageRow[]>("/api/slippage"),
  risk:          () => get<RiskData>("/api/risk"),
  spreads:       () => get<Spread[]>("/api/spreads"),
  opportunities: () => get<Opportunity[]>("/api/opportunities"),
  trades:        () => get<Trade[]>("/api/trades"),
  priceTicks:    () => get<PriceTick[]>("/api/price-ticks"),
  runScan:       () => post<{ status: string; message: string }>("/api/run-scan"),
};
