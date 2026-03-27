// === Currency Formatters ===
export function formatCurrency(value: number, decimals: number = 2): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function formatLargeNumber(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function formatPercent(value: number, decimals: number = 2): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}%`;
}

export function formatPercentNoSign(value: number, decimals: number = 2): string {
  return `${value.toFixed(decimals)}%`;
}

export function formatNumber(value: number, decimals: number = 2): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatShares(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}

export function formatRatio(value: number): string {
  return `${value.toFixed(1)}:1`;
}

// Color helpers
export function getChangeColor(value: number): string {
  if (value > 0) return "text-emerald-500";
  if (value < 0) return "text-red-500";
  return "text-muted-foreground";
}

export function getCRVColor(value: number): string {
  if (value >= 2.5) return "text-emerald-500";
  if (value >= 2.0) return "text-amber-500";
  return "text-red-500";
}

export function getCRVBgColor(value: number): string {
  if (value >= 2.5) return "bg-emerald-500/10 border-emerald-500/20";
  if (value >= 2.0) return "bg-amber-500/10 border-amber-500/20";
  return "bg-red-500/10 border-red-500/20";
}

export function getRSLColor(value: number): string {
  if (value > 110) return "text-emerald-500";
  if (value > 105) return "text-amber-500";
  return "text-red-500";
}

export function getRSLBgColor(value: number): string {
  if (value > 110) return "bg-emerald-500";
  if (value > 105) return "bg-amber-500";
  return "bg-red-500";
}
