/**
 * Generische Segment-YoY-Lücken.
 *
 * Exakte Jahresnamen bleiben außen vor — die liefert fmp.ts schon als Fakt.
 * Hier landen nur Lücken: umbenannte/zusammengelegte Vorperioden, Quartale
 * oder TTM, und das Residuum aus den Financial Statements.
 * Schwellen kommen aus der jeweiligen Stichprobe (Median, Perzentil, MAD).
 * Gewichte und Spread-Regeln sind benannte Parameter, keine stillen Cutoffs.
 */

export const SEGMENT_SIMILARITY_WEIGHTS = {
  jaccard: 1,
  containment: 1,
} as const;

/** Linguistische Füllwörter, keine numerische Schwelle. */
export const SEGMENT_NAME_STOPWORDS = new Set([
  "and", "und", "the", "of", "products", "product", "services", "service", "segment",
]);

export const YOY_PROXIMITY = {
  spread: "mad",
} as const;

export const STATEMENT_REVENUE = {
  spread: "mad",
} as const;

export const OTHER_SEGMENT_NAME = "Other / nicht segmentiert";

const SEGMENT_SKIP_KEYS = new Set([
  "symbol", "date", "reportedCurrency", "cik", "fillingDate",
  "acceptedDate", "calendarYear", "period", "link", "finalLink",
  "fiscalYear",
]);

export interface SegmentLine {
  name: string;
  revenue: number;
}

export interface SegmentSnapshot {
  periodKey: string;
  rows: SegmentLine[];
}

export interface StatementYear {
  periodKey: string;
  income?: number | null;
  cashflow?: number | null;
  balance?: number | null;
}

export type SegmentGrowthMethod =
  | "adaptive-name"
  | "merge"
  | "revenue-proximity"
  | "quarter-yoy"
  | "ttm"
  | "residual-identity"
  | "residual-bucket";

export interface SegmentGrowthAnnotation {
  name: string;
  growth: number | null;
  basis: "berechnet" | "n/a";
  method: SegmentGrowthMethod | "unresolved";
  formula: string | null;
  source: string | null;
  reason: string | null;
  prevRevenue?: number;
  prevPeriodKey?: string;
}

export interface AnnotateSegmentGrowthInput {
  annual: SegmentSnapshot[];
  quarterly?: SegmentSnapshot[];
  statements?: StatementYear[];
}

interface Indexed {
  name: string;
  key: string;
  tokens: string[];
  revenue: number;
}

interface Assignment {
  name: string;
  prevRevenue: number;
  prevNames: string[];
  method: SegmentGrowthMethod;
  prevPeriodKey: string;
  source: string;
  /** Gleicher Token-Key in der Vergleichsperiode. Jahres-Treffer bleiben Fakt. */
  exact: boolean;
}

export function prettifyProductSegmentName(raw: string): string {
  return raw
    .replace(/^Microsoft Three Six Five/, "Microsoft 365")
    .replace(/\s+And\s+/g, " & ")
    .replace(/\s+Products?\s+&\s+Cloud\s+Services$/i, "")
    .replace(/\s+Products?\s+And\s+Cloud\s+Services$/i, "")
    .replace(/\s+Products?\s+&\s+Services$/i, "")
    .replace(/\s+Products?\s+And\s+Services$/i, "")
    .replace(/\s+Corporation$/, "")
    .replace(/\s+Inc\.?$/, "")
    .trim();
}

export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo];
  const weight = rank - lo;
  return sortedAsc[lo] * (1 - weight) + sortedAsc[hi] * weight;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 50);
}

function mad(values: number[]): number {
  if (values.length === 0) return NaN;
  const mid = median(values);
  return median(values.map((v) => Math.abs(v - mid)));
}

export function roundGrowthPct(current: number, prev: number): number | null {
  if (!(current > 0) || !(prev > 0) || !Number.isFinite(current) || !Number.isFinite(prev)) return null;
  const pct = (current / prev - 1) * 100;
  if (!Number.isFinite(pct)) return null;
  return Math.round(pct * 10) / 10;
}

function money(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Number.isInteger(n)) return `$${n}`;
  return `$${n.toFixed(2)}`;
}

function formulaOf(current: number, prev: number, growth: number, detail: string): string {
  const sign = growth > 0 ? "+" : "";
  return `${detail}(${money(current)} / ${money(prev)} − 1) × 100 = ${sign}${growth}%`;
}

export function segmentTokens(name: string): string[] {
  const parts = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9äöüß]+/)
    .filter((token) => token.length > 0 && !SEGMENT_NAME_STOPWORDS.has(token));
  return Array.from(new Set(parts)).sort();
}

function tokenKey(tokens: string[]): string {
  return tokens.join("|");
}

function jaccard(a: string[], b: string[]): number {
  const right = new Set(b);
  let inter = 0;
  for (const token of a) if (right.has(token)) inter += 1;
  const union = a.length + b.length - inter;
  return union === 0 ? 0 : inter / union;
}

function isSubset(part: string[], whole: string[]): boolean {
  if (part.length === 0) return false;
  const set = new Set(whole);
  return part.every((token) => set.has(token));
}

function indexRows(rows: SegmentLine[]): Indexed[] {
  const map = new Map<string, Indexed>();
  for (const row of rows) {
    if (!row || typeof row.name !== "string" || !row.name.trim()) continue;
    const revenue = Number(row.revenue);
    if (!Number.isFinite(revenue) || !(revenue > 0)) continue;
    const name = prettifyProductSegmentName(row.name.trim());
    const tokens = segmentTokens(name);
    if (tokens.length === 0) continue;
    const key = tokenKey(tokens);
    const existing = map.get(key);
    if (!existing || revenue > existing.revenue) {
      map.set(key, { name, key, tokens, revenue });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
}

function periodSortKey(row: SegmentSnapshot): string {
  return row.periodKey || "";
}

function orderedSnapshots(rows: SegmentSnapshot[] | undefined): SegmentSnapshot[] {
  if (!Array.isArray(rows)) return [];
  const byKey = new Map<string, SegmentSnapshot>();
  for (const row of rows) {
    if (!row || typeof row.periodKey !== "string" || !row.periodKey) continue;
    const existing = byKey.get(row.periodKey);
    if (!existing || row.rows.length > existing.rows.length) byKey.set(row.periodKey, row);
  }
  return Array.from(byKey.values()).sort((a, b) => periodSortKey(b).localeCompare(periodSortKey(a)));
}

export function snapshotsFromFmpRows(rows: unknown[]): SegmentSnapshot[] {
  if (!Array.isArray(rows)) return [];
  const snapshots: SegmentSnapshot[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const periodKey = String(rec.date ?? rec.reportedDate ?? (rec.fiscalYear != null && rec.period != null ? `${rec.fiscalYear}-${rec.period}` : rec.fiscalYear ?? rec.calendarYear ?? ""));
    if (!periodKey) continue;
    const src = rec.data && typeof rec.data === "object" ? rec.data as Record<string, unknown> : rec;
    const lines: SegmentLine[] = [];
    for (const [key, val] of Object.entries(src)) {
      if (SEGMENT_SKIP_KEYS.has(key)) continue;
      const num = Number(val);
      if (Number.isFinite(num) && num > 0) lines.push({ name: key, revenue: num });
    }
    if (lines.length > 0) snapshots.push({ periodKey, rows: lines });
  }
  return orderedSnapshots(snapshots);
}

export function reconcileStatementRevenue(year: StatementYear | undefined): { value: number; source: string } | null {
  if (!year) return null;
  const parts: { name: string; value: number }[] = [];
  const candidates: Array<[string, number | null | undefined]> = [
    ["income", year.income],
    ["cashflow", year.cashflow],
    ["balance", year.balance],
  ];
  for (const [name, value] of candidates) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) parts.push({ name, value });
  }
  if (parts.length === 0) return null;
  if (parts.length === 1) {
    return { value: parts[0].value, source: `FMP ${parts[0].name}-statement` };
  }
  const values = parts.map((p) => p.value);
  const mid = median(values);
  const spread = mad(values);
  const kept = parts.filter((p) => Math.abs(p.value - mid) <= (spread > 0 ? spread : 0));
  const used = kept.length > 0 ? kept : parts;
  const value = median(used.map((p) => p.value));
  return { value, source: `FMP Financial Statements Median (${used.map((p) => p.name).join("+")}, ${STATEMENT_REVENUE.spread})` };
}

function similarity(a: string[], b: string[]): number {
  const jac = jaccard(a, b);
  const contain = isSubset(a, b) || isSubset(b, a) ? 1 : 0;
  const weights = SEGMENT_SIMILARITY_WEIGHTS;
  return (weights.jaccard * jac + weights.containment * contain) / (weights.jaccard + weights.containment);
}

function logChange(current: number, prev: number): number | null {
  if (!(current > 0) || !(prev > 0)) return null;
  const value = Math.log(current / prev);
  return Number.isFinite(value) ? value : null;
}

function bandFromLogs(logs: number[]): { lo: number; hi: number; mid: number } | null {
  if (logs.length < 2) return null;
  const sorted = [...logs].sort((a, b) => a - b);
  const spread = mad(logs);
  if (!(spread >= 0)) return null;
  return {
    lo: sorted[0] - spread,
    hi: sorted[sorted.length - 1] + spread,
    mid: median(logs),
  };
}

function assignMaps(
  current: Indexed[],
  prior: Indexed[],
  prevPeriodKey: string,
  sourcePrefix: string,
  methodFor: (kind: "adaptive-name" | "merge" | "revenue-proximity") => SegmentGrowthMethod,
  seedLogs: number[] = [],
): Assignment[] {
  const usedPrior = new Set<string>();
  const assigned = new Set<string>();
  const out: Assignment[] = [];

  const take = (
    row: Indexed,
    prevRevenue: number,
    prevNames: string[],
    method: Assignment["method"],
    priorKeys: string[],
    source: string,
    exact: boolean,
  ) => {
    assigned.add(row.key);
    for (const key of priorKeys) usedPrior.add(key);
    out.push({
      name: row.name,
      prevRevenue,
      prevNames,
      method,
      prevPeriodKey,
      source,
      exact,
    });
  };

  for (const row of current) {
    const hit = prior.find((p) => p.key === row.key);
    if (!hit) continue;
    take(row, hit.revenue, [hit.name], methodFor("adaptive-name"), [hit.key], sourcePrefix, true);
  }

  const freeCurrent = () => current.filter((row) => !assigned.has(row.key));
  const freePrior = () => prior.filter((row) => !usedPrior.has(row.key));

  for (const row of freeCurrent()) {
    const parts = freePrior().filter((p) => p.tokens.length > 0 && isSubset(p.tokens, row.tokens));
    if (parts.length < 2) continue;
    const union = new Set<string>();
    let overlap = false;
    const seen = new Set<string>();
    for (const part of parts) {
      for (const token of part.tokens) {
        if (seen.has(token)) overlap = true;
        seen.add(token);
        union.add(token);
      }
    }
    if (overlap) continue;
    if (tokenKey(Array.from(union).sort()) !== row.key) continue;
    const prevRevenue = parts.reduce((sum, part) => sum + part.revenue, 0);
    take(
      row,
      prevRevenue,
      parts.map((p) => p.name),
      methodFor("merge"),
      parts.map((p) => p.key),
      `${sourcePrefix} Summe ${parts.map((p) => p.name).join(" + ")}`,
      false,
    );
  }

  for (const row of freeCurrent()) {
    const candidates = freePrior().filter((p) => {
      const shorter = row.tokens.length <= p.tokens.length ? row.tokens : p.tokens;
      const longer = row.tokens.length <= p.tokens.length ? p.tokens : row.tokens;
      return isSubset(shorter, longer) && similarity(row.tokens, p.tokens) > 0;
    });
    if (candidates.length === 0) continue;
    const ranked = candidates
      .map((p) => ({ p, score: similarity(row.tokens, p.tokens) }))
      .sort((a, b) => b.score - a.score);
    const scores = ranked.map((r) => r.score).sort((a, b) => a - b);
    const threshold = percentile(scores, 75);
    const best = ranked[0];
    const second = ranked[1];
    if (best.score < threshold) continue;
    if (second && !(best.score > second.score)) continue;
    take(
      row,
      best.p.revenue,
      [best.p.name],
      methodFor("adaptive-name"),
      [best.p.key],
      `${sourcePrefix} Namensähnlichkeit ${best.p.name}`,
      false,
    );
  }

  const logs = [...seedLogs];
  for (const row of current) {
    const hit = out.find((a) => a.name === row.name);
    if (!hit) continue;
    const change = logChange(row.revenue, hit.prevRevenue);
    if (change != null) logs.push(change);
  }
  const band = bandFromLogs(logs);
  if (band) {
    type Pair = { row: Indexed; prev: Indexed; cost: number; change: number };
    const pairs: Pair[] = [];
    for (const row of freeCurrent()) {
      for (const prev of freePrior()) {
        const change = logChange(row.revenue, prev.revenue);
        if (change == null || change < band.lo || change > band.hi) continue;
        pairs.push({ row, prev, change, cost: Math.abs(change - band.mid) });
      }
    }
    const byCurrent = new Map<string, Pair[]>();
    const byPrior = new Map<string, Pair[]>();
    for (const pair of pairs) {
      const c = byCurrent.get(pair.row.key) ?? [];
      c.push(pair);
      byCurrent.set(pair.row.key, c);
      const p = byPrior.get(pair.prev.key) ?? [];
      p.push(pair);
      byPrior.set(pair.prev.key, p);
    }
    for (const row of freeCurrent()) {
      const options = (byCurrent.get(row.key) ?? []).sort((a, b) => a.cost - b.cost);
      if (options.length === 0) continue;
      const best = options[0];
      const second = options[1];
      if (second && !(best.cost < second.cost)) continue;
      const priorOptions = (byPrior.get(best.prev.key) ?? []).sort((a, b) => a.cost - b.cost);
      const priorSecond = priorOptions[1];
      if (priorOptions[0]?.row.key !== row.key) continue;
      if (priorSecond && !(priorOptions[0].cost < priorSecond.cost)) continue;
      take(
        row,
        best.prev.revenue,
        [best.prev.name],
        methodFor("revenue-proximity"),
        [best.prev.key],
        `${sourcePrefix} Umsatznähe ${best.prev.name} (Band ${YOY_PROXIMITY.spread} der gematchten YoY)`,
        false,
      );
    }
  }

  return out;
}

function isDirectAnnual(hit: Assignment, row: Indexed): boolean {
  return hit.exact && hit.prevNames.length === 1 && tokenKey(segmentTokens(hit.prevNames[0])) === row.key;
}

function aggregateWindow(snapshots: SegmentSnapshot[]): Indexed[] {
  if (snapshots.length === 0) return [];
  const counts = new Map<string, { name: string; tokens: string[]; revenue: number; seen: number }>();
  for (const snap of snapshots) {
    const rows = indexRows(snap.rows);
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.key)) continue;
      seen.add(row.key);
      const acc = counts.get(row.key) ?? { name: row.name, tokens: row.tokens, revenue: 0, seen: 0 };
      acc.revenue += row.revenue;
      acc.seen += 1;
      counts.set(row.key, acc);
    }
  }
  const out: Indexed[] = [];
  counts.forEach((acc, key) => {
    if (acc.seen !== snapshots.length) return;
    out.push({ name: acc.name, key, tokens: acc.tokens, revenue: acc.revenue });
  });
  return out.sort((a, b) => b.revenue - a.revenue);
}

function toAnnotation(row: Indexed, assignment: Assignment): SegmentGrowthAnnotation {
  const growth = roundGrowthPct(row.revenue, assignment.prevRevenue);
  if (growth == null) {
    return {
      name: row.name,
      growth: null,
      basis: "n/a",
      method: "unresolved",
      formula: null,
      source: assignment.source,
      reason: "n/a — Vorperioden-Umsatz nicht positiv",
    };
  }
  const detail = assignment.method === "merge"
    ? `Summe ${assignment.prevNames.join(" + ")}: `
    : assignment.method === "residual-identity" || assignment.method === "residual-bucket"
      ? "Residuum: "
      : "";
  return {
    name: row.name,
    growth,
    basis: "berechnet",
    method: assignment.method,
    formula: formulaOf(row.revenue, assignment.prevRevenue, growth, detail),
    source: assignment.source,
    reason: null,
    prevRevenue: assignment.prevRevenue,
    prevPeriodKey: assignment.prevPeriodKey,
  };
}

function unresolved(name: string, reason: string): SegmentGrowthAnnotation {
  return {
    name,
    growth: null,
    basis: "n/a",
    method: "unresolved",
    formula: null,
    source: null,
    reason,
  };
}

export function annotateMissingSegmentGrowth(input: AnnotateSegmentGrowthInput): SegmentGrowthAnnotation[] {
  const annual = orderedSnapshots(input.annual);
  if (annual.length === 0) return [];
  const current = indexRows(annual[0].rows);
  const prior = annual.length >= 2 ? indexRows(annual[1].rows) : [];
  const prevKey = annual[1]?.periodKey ?? "";
  const annualAssigned = prior.length > 0
    ? assignMaps(
      current,
      prior,
      prevKey,
      `FMP Segment Vorperiode ${prevKey}`,
      (kind) => kind,
    )
    : [];

  const calculated = new Map<string, SegmentGrowthAnnotation>();
  const seedLogs: number[] = [];
  for (const row of current) {
    const hit = annualAssigned.find((a) => a.name === row.name);
    if (!hit) continue;
    const change = logChange(row.revenue, hit.prevRevenue);
    if (change != null) seedLogs.push(change);
    if (isDirectAnnual(hit, row)) {
      const priorName = hit.prevNames[0] ?? "";
      if (priorName.trim() === row.name.trim()) continue;
      calculated.set(row.name, toAnnotation(row, hit));
      continue;
    }
    calculated.set(row.name, toAnnotation(row, hit));
  }

  const stillOpen = () => current.filter((row) => {
    if (calculated.has(row.name)) return false;
    const hit = annualAssigned.find((a) => a.name === row.name);
    return !(hit && isDirectAnnual(hit, row));
  });

  const quarterly = orderedSnapshots(input.quarterly);
  const openBeforeQuarter = stillOpen();
  if (openBeforeQuarter.length > 0 && quarterly.length >= 5) {
    const windows: Array<{ now: SegmentSnapshot[]; prev: SegmentSnapshot[]; method: "ttm" | "quarter-yoy"; label: string }> = [];
    if (quarterly.length >= 8) {
      windows.push({
        now: quarterly.slice(0, 4),
        prev: quarterly.slice(4, 8),
        method: "ttm",
        label: `FMP Segment Quartale TTM ${quarterly[0].periodKey}..${quarterly[3].periodKey} vs ${quarterly[4].periodKey}..${quarterly[7].periodKey}`,
      });
    }
    windows.push({
      now: [quarterly[0]],
      prev: [quarterly[4]],
      method: "quarter-yoy",
      label: `FMP Segment Quartal ${quarterly[0].periodKey} vs ${quarterly[4].periodKey}`,
    });
    for (const window of windows) {
      const pending = stillOpen();
      if (pending.length === 0) break;
      const nowRows = aggregateWindow(window.now);
      const prevRows = aggregateWindow(window.prev);
      if (nowRows.length === 0 || prevRows.length === 0) continue;
      const pendingKeys = new Set(pending.map((row) => row.key));
      const focused = nowRows.filter((row) => pendingKeys.has(row.key));
      if (focused.length === 0) continue;
      const found = assignMaps(
        focused,
        prevRows,
        window.prev[window.prev.length - 1]?.periodKey ?? window.label,
        window.label,
        () => window.method,
        seedLogs,
      );
      for (const row of pending) {
        const hit = found.find((a) => a.name === row.name);
        if (!hit || calculated.has(row.name)) continue;
        const basisRow = focused.find((f) => f.name === row.name) ?? row;
        const annotation = toAnnotation({ ...basisRow, name: row.name }, { ...hit, method: window.method });
        if (annotation.basis === "berechnet") calculated.set(row.name, annotation);
      }
    }
  }

  const statements = [...(input.statements ?? [])].filter((y) => y && typeof y.periodKey === "string").sort((a, b) => b.periodKey.localeCompare(a.periodKey));
  const revNow = reconcileStatementRevenue(statements[0]);
  const revPrev = reconcileStatementRevenue(statements[1]);
  const open = stillOpen();

  if (open.length === 1 && prior.length > 0 && revPrev && revNow) {
    const hole = open[0];
    const matchedPrev = annualAssigned
      .filter((a) => a.name !== hole.name)
      .reduce((sum, a) => sum + a.prevRevenue, 0);
    const usedPriorKeys = new Set(annualAssigned.flatMap((a) => a.prevNames.map((n) => tokenKey(segmentTokens(n)))));
    const unusedPrior = prior.filter((p) => !usedPriorKeys.has(p.key));
    if (unusedPrior.length === 0) {
      const implied = revPrev.value - matchedPrev;
      const logs = annualAssigned
        .map((a) => logChange(current.find((c) => c.name === a.name)?.revenue ?? NaN, a.prevRevenue))
        .filter((v): v is number => v != null);
      const band = bandFromLogs(logs);
      const change = logChange(hole.revenue, implied);
      if (implied > 0 && change != null && band && change >= band.lo && change <= band.hi) {
        const growth = roundGrowthPct(hole.revenue, implied);
        if (growth != null) {
          calculated.set(hole.name, {
            name: hole.name,
            growth,
            basis: "berechnet",
            method: "residual-identity",
            formula: `Residuum: Umsatz_Vorperiode − Σ bekannte Segmente_Vorperiode = ${money(implied)}. (${money(hole.revenue)} / ${money(implied)} − 1) × 100 = ${growth > 0 ? "+" : ""}${growth}%`,
            source: `${revPrev.source} minus Summe bekannter Segmente ${statements[1].periodKey}`,
            reason: null,
            prevRevenue: implied,
            prevPeriodKey: statements[1].periodKey,
          });
        }
      }
    }
  }

  const annotations: SegmentGrowthAnnotation[] = [];
  for (const row of current) {
    const hit = calculated.get(row.name);
    if (hit) {
      annotations.push(hit);
      continue;
    }
    const direct = annualAssigned.find((a) => a.name === row.name && isDirectAnnual(a, row));
    if (direct) continue;
    let reason = "n/a — keine Vorperioden-Segmentwerte, keine vollständigen Quartale/TTM";
    if (annual.length < 2 && quarterly.length < 5) {
      reason = "n/a — nur ein Segmentjahr, Quartale/TTM ohne Vorperiode, Residuum der Vorperiode nicht belegbar";
    } else if (open.length >= 2 && !calculated.has(row.name)) {
      reason = `n/a — ${open.length} Segmente ohne eindeutige Vorperiode, Residuum nicht auflösbar`;
    } else if (annual.length >= 2) {
      reason = "n/a — Vorperiode vorhanden, aber weder Name noch Umsatznähe im datenabhängigen Band";
    }
    annotations.push(unresolved(row.name, reason));
  }

  if (revNow && revPrev && prior.length > 0) {
    const sumNow = current.reduce((sum, row) => sum + row.revenue, 0);
    const sumPrev = prior.reduce((sum, row) => sum + row.revenue, 0);
    const residualNow = revNow.value - sumNow;
    const residualPrev = revPrev.value - sumPrev;
    const growth = roundGrowthPct(residualNow, residualPrev);
    if (growth != null && residualNow > 0 && residualPrev > 0) {
      annotations.push({
        name: OTHER_SEGMENT_NAME,
        growth,
        basis: "berechnet",
        method: "residual-bucket",
        formula: `Residuum_t = ${money(revNow.value)} − ${money(sumNow)} = ${money(residualNow)}; Residuum_t−1 = ${money(revPrev.value)} − ${money(sumPrev)} = ${money(residualPrev)}; (${money(residualNow)} / ${money(residualPrev)} − 1) × 100 = ${growth > 0 ? "+" : ""}${growth}%`,
        source: `${revNow.source} und ${revPrev.source}, abzüglich Summe der bekannten Segmente`,
        reason: null,
        prevRevenue: residualPrev,
        prevPeriodKey: statements[1]?.periodKey,
      });
    } else if (!(residualNow > 0) || !(residualPrev > 0)) {
      annotations.push(unresolved(OTHER_SEGMENT_NAME, "n/a — Residuum nicht positiv in beiden Perioden"));
    }
  } else if (annual.length < 2 && revNow && revPrev) {
    const sumNow = current.reduce((sum, row) => sum + row.revenue, 0);
    const residualNow = revNow.value - sumNow;
    annotations.push(unresolved(
      OTHER_SEGMENT_NAME,
      `n/a — nur ein Segmentjahr. Residuum_t = ${money(revNow.value)} − ${money(sumNow)} = ${money(residualNow)} ist belegbar, Residuum_t−1 fehlt (keine Segment-Vorperiode)`,
    ));
  }

  return annotations;
}

export function annotationByName(annotations: SegmentGrowthAnnotation[] | null | undefined, name: string): SegmentGrowthAnnotation | null {
  if (!annotations || !name) return null;
  const target = prettifyProductSegmentName(name).toLowerCase();
  return annotations.find((row) => prettifyProductSegmentName(row.name).toLowerCase() === target) ?? null;
}
