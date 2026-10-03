/**
 * Sektion 14. Eine Flaeche: Bitcoin-Nachrichten, gemessene FRED-Richtungen
 * und die KI-Notiz. Belegte Regeln aus dem Policy-Scan stehen als Key-Event-Karten
 * mit Inflation, Zinsen und BTC. Der violette KI-Chip ruft einmal POST policy-scan auf.
 * Muenzumlauf und gesperrte Protokollwerte sind hier keine gemessene Liquiditaet.
 */
import { useEffect, useState, type ReactNode } from "react";
import { SectionCard } from "@/components/SectionCard";
import { apiRequest } from "@/lib/queryClient";
import { btcSourceRole, filterBtcNewsItems, isAllowedBtcCitation } from "@shared/btc-source-policy";
import { allowedKeyEventEvidence, canonicalDocumentTitle, keyEventBody } from "@shared/policy-event-copy";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronRight, Flame, Loader2, Minus, Sparkles } from "lucide-react";

interface SeriesDirectionReading {
  latest: number | null;
  level1y: number | null;
  level2y: number | null;
  diff1y: number | null;
  diff2y: number | null;
  direction1y: string;
  direction2y: string;
}

interface ScanMeasured {
  policyRate?: number | null;
  realYield10y?: number | null;
  dgs10?: number | null;
  m2Bn?: number | null;
  tgaBn?: number | null;
  windows?: {
    policyRate?: SeriesDirectionReading;
    realYield10y?: SeriesDirectionReading;
    dgs10?: SeriesDirectionReading;
    m2Bn?: SeriesDirectionReading;
    tgaBn?: SeriesDirectionReading;
  };
}

interface PolicyNote {
  summary: string | null;
  ratesView: string | null;
  liquidityView: string | null;
  fiscalView: string | null;
  keyDrivers: string[];
  btcImplication: string | null;
}

interface PolicyScanInstrument {
  id: string;
  title?: string;
  office: string;
  instrumentType: string;
  status: string;
  officeHolder?: string;
  channels: Record<string, string>;
  evidence: { source: string; url: string; date: string }[];
}

interface RegulationNoteDto {
  id: string;
  title: string;
  office: string;
  instrumentType?: string;
  status: string;
  confidence: "cited" | "estimated";
  channels: Record<string, string>;
  note?: string;
  evidence?: { source: string; url: string; date: string }[];
}

interface PolicyScanResponse {
  llmAvailable: boolean;
  fromCache: boolean;
  modelUsed: string | null;
  summary: string | null;
  error?: string;
  instruments: PolicyScanInstrument[];
  regulations?: RegulationNoteDto[];
  dropped: number;
  _fallback?: boolean;
  measured?: ScanMeasured;
  note?: PolicyNote;
}

interface BtcNewsItem {
  title: string;
  source: string;
  url: string;
  relativeTime: string;
  lang?: string;
  sentiment?: "bullish" | "bearish" | "neutral";
  sentimentScore?: number;
}

const OFFICE_LABEL: Record<string, string> = {
  treasury: "Treasury",
  central_bank: "Zentralbank",
  legislature: "Gesetzgeber",
  regulator: "Aufsicht",
};

const TAG_LABEL: Record<string, string> = {
  tBillDemand: "T-Bill-Nachfrage",
  m2: "M2",
};

const CATEGORY_BADGES: Record<string, string> = {
  "Geldpolitik": "bg-blue-500/15 text-blue-300 border-blue-400/30",
  "Fiskalpolitik": "bg-indigo-500/15 text-indigo-300 border-indigo-400/30",
  "Tech/Regulierung": "bg-cyan-500/15 text-cyan-300 border-cyan-400/30",
  "Sonstiges": "bg-foreground/10 text-foreground/60 border-border/40",
};

const STATUS_DOT: Record<string, string> = {
  enacted: "bg-emerald-400",
  implementing: "bg-emerald-400",
  advanced: "bg-amber-400",
  proposed: "bg-amber-400",
  rejected: "bg-red-400",
  expired: "bg-red-400",
  uncertain: "bg-foreground/30",
};

const TYPE_LABEL: Record<string, string> = {
  statute: "Gesetz",
  fiscal_program: "Fiskalprogramm",
  debt_operation: "Schuldenoperation",
};

function formatUsdCompact(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/v";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)} Bio.`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)} Mrd.`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)} Mio.`;
  return `${sign}$${abs.toFixed(0)}`;
}

function formatPct(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "n/v" : `${value.toFixed(2)}%`;
}

function SeriesMark({ direction }: { direction: string }) {
  if (direction === "steigend") {
    return <ArrowUp data-testid="series-up" className="w-3 h-3 shrink-0 text-emerald-400" aria-hidden />;
  }
  if (direction === "fallend") {
    return <ArrowDown data-testid="series-down" className="w-3 h-3 shrink-0 text-red-400" aria-hidden />;
  }
  if (direction === "unverändert") {
    return <Minus data-testid="series-flat" className="w-3 h-3 shrink-0 text-muted-foreground" aria-hidden />;
  }
  return null;
}

function directionDetail(reading: SeriesDirectionReading | undefined): ReactNode {
  const one = reading?.direction1y || "unbekannt";
  const two = reading?.direction2y || "unbekannt";
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1">
      <span className="inline-flex items-center gap-0.5">
        <span>1J {one}</span>
        <SeriesMark direction={one} />
      </span>
      <span aria-hidden>·</span>
      <span className="inline-flex items-center gap-0.5">
        <span>2J {two}</span>
        <SeriesMark direction={two} />
      </span>
    </span>
  );
}

function MiniCard({ label, value, sub, detail }: { label: string; value: string; sub?: string; detail?: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-base font-mono font-semibold tabular-nums mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      {detail && <div className="text-[10px] text-muted-foreground mt-0.5">{detail}</div>}
    </div>
  );
}

export function MeasuredFredCards({ measured }: { measured: ScanMeasured }) {
  const windows = measured.windows;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2" data-testid="text-measured-rates">
      <MiniCard label="Leitzins" value={formatPct(measured.policyRate)} sub="FRED, gemessen" detail={directionDetail(windows?.policyRate)} />
      <MiniCard label="Realzins 10Y" value={formatPct(measured.realYield10y)} sub="FRED, gemessen" detail={directionDetail(windows?.realYield10y)} />
      <MiniCard label="10-Jahres-Rendite" value={formatPct(measured.dgs10)} sub="FRED, gemessen" detail={directionDetail(windows?.dgs10)} />
      <MiniCard label="M2" value={formatUsdCompact(measured.m2Bn == null ? null : measured.m2Bn * 1e9)} sub="FRED, gemessen" detail={directionDetail(windows?.m2Bn)} />
      <MiniCard label="TGA" value={formatUsdCompact(measured.tgaBn == null ? null : measured.tgaBn * 1e9)} sub="FRED, gemessen" detail={directionDetail(windows?.tgaBn)} />
    </div>
  );
}

export function eventCategory(office: string, instrumentType?: string): string {
  if (office === "central_bank") return "Geldpolitik";
  if (office === "treasury" || instrumentType === "fiscal_program" || instrumentType === "debt_operation") return "Fiskalpolitik";
  if (office === "regulator" || office === "legislature") return "Tech/Regulierung";
  return "Sonstiges";
}

/** Drei Briefing-Chips aus der Wirkung im Dokument. Fehlende oder widersprüchliche Kanäle bleiben neutral. */
export function briefingImpacts(channels: Record<string, string> | undefined): {
  inflation: "steigend" | "fallend" | "neutral";
  rates: "steigend" | "fallend" | "neutral";
  btc: "positiv" | "negativ" | "neutral";
} {
  const level = (value: string | undefined): "steigend" | "fallend" | "neutral" => {
    if (value === "up") return "steigend";
    if (value === "down") return "fallend";
    return "neutral";
  };
  const rateVotes = [channels?.policyRate, channels?.realYield, channels?.longYield].filter(
    (value): value is "up" | "down" => value === "up" || value === "down",
  );
  const ups = rateVotes.filter(value => value === "up").length;
  const downs = rateVotes.length - ups;
  const rates = ups > 0 && downs === 0 ? "steigend" : downs > 0 && ups === 0 ? "fallend" : "neutral";
  const liquidity = channels?.cryptoLiquidity;
  const btc = liquidity === "up" ? "positiv" : liquidity === "down" ? "negativ" : "neutral";
  return { inflation: level(channels?.inflation), rates, btc };
}

export interface PolicyEventInput {
  id: string;
  title: string;
  office: string;
  instrumentType?: string;
  status: string;
  channels: Record<string, string>;
  note?: string;
  holder?: string;
  evidence?: { source: string; url: string; date: string }[];
}

export function collectPolicyEvents(
  regulations: RegulationNoteDto[],
  instruments: PolicyScanInstrument[],
): PolicyEventInput[] {
  const events: PolicyEventInput[] = [];
  const seen = new Set<string>();
  const remember = (title: string) => {
    const key = title.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  const headingFor = (title: string, evidence?: { url: string }[]) => canonicalDocumentTitle(
    title,
    evidence?.find(item => /^https:\/\//i.test(item.url || ""))?.url,
  );
  for (const reg of regulations) {
    if (reg.confidence !== "cited") continue;
    const evidence = allowedKeyEventEvidence(reg.evidence);
    if (evidence.length === 0) continue;
    const title = headingFor(reg.title, evidence);
    if (!remember(title)) continue;
    events.push({
      id: reg.id,
      title,
      office: reg.office,
      instrumentType: reg.instrumentType,
      status: reg.status,
      channels: reg.channels,
      note: keyEventBody(reg.note, title, reg.channels, evidence) ?? undefined,
      evidence,
    });
  }
  for (const inst of instruments) {
    const evidence = allowedKeyEventEvidence(inst.evidence);
    if (evidence.length === 0) continue;
    const title = headingFor(
      inst.title?.trim()
        || [OFFICE_LABEL[inst.office] ?? inst.office, TYPE_LABEL[inst.instrumentType] ?? inst.instrumentType, inst.status].filter(Boolean).join(" · "),
      evidence,
    );
    if (!remember(title)) continue;
    events.push({
      id: inst.id,
      title,
      office: inst.office,
      instrumentType: inst.instrumentType,
      status: inst.status,
      channels: inst.channels,
      note: keyEventBody(undefined, title, inst.channels, evidence) ?? undefined,
      evidence,
      ...(inst.officeHolder ? { holder: inst.officeHolder } : {}),
    });
  }
  return events;
}

function ImpactBadge({ label, value, rateImpact = false }: { label: string; value: string; rateImpact?: boolean }) {
  const isUp = value === "steigend" || value === "positiv";
  const isDown = value === "fallend" || value === "negativ";
  // Direction stays the document's word (steigend = arrow up). Color for the rate chip
  // is the BTC-liquidity implication: higher rates tighten liquidity, so up is red.
  const color = !isUp && !isDown
    ? "text-foreground/50"
    : rateImpact
      ? (isUp ? "rate-impact-negative text-red-400" : "rate-impact-positive text-emerald-400")
      : (isUp ? "text-emerald-400" : "text-red-400");
  const Icon = isUp ? ArrowUp : isDown ? ArrowDown : Minus;
  return (
    <div className="flex items-center gap-1" data-testid={`impact-${label.toLowerCase()}`}>
      <span className="text-[9px] uppercase tracking-wider text-foreground/40">{label}</span>
      <Icon
        data-testid={isUp ? "impact-up" : isDown ? "impact-down" : "impact-neutral"}
        className={`w-2.5 h-2.5 ${color}`}
        aria-hidden
      />
      <span className={`text-[10px] font-medium ${color}`}>{value}</span>
    </div>
  );
}

export function PolicyEventCard({ event }: { event: PolicyEventInput }) {
  const impacts = briefingImpacts(event.channels);
  const category = eventCategory(event.office, event.instrumentType);
  const catClass = CATEGORY_BADGES[category] || CATEGORY_BADGES.Sonstiges;
  const dot = STATUS_DOT[event.status] || "bg-foreground/30";
  const link = event.evidence?.find(item => /^https:\/\//i.test(item.url || ""));
  const heading = canonicalDocumentTitle(event.title, link?.url);
  const body = keyEventBody(event.note, heading, event.channels, event.evidence);
  const tags = Object.entries(TAG_LABEL)
    .filter(([key]) => event.channels?.[key] === "up" || event.channels?.[key] === "down")
    .map(([, label]) => label);
  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-3 hover:bg-background/60 transition-colors" data-testid="policy-event-card">
      <div className="flex items-start gap-2 mb-2">
        <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} title={event.status} />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold text-foreground/90 leading-tight" data-testid="policy-event-title">{heading}</div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className={`text-[9px] px-1.5 py-0.5 rounded border ${catClass}`}>{category}</span>
            {link?.date && <span className="text-[9px] text-foreground/50">· {link.date}</span>}
            {event.holder && <span className="text-[9px] text-foreground/50">· {event.holder}</span>}
          </div>
        </div>
      </div>
      {body && <p className="text-[11px] text-foreground/75 leading-relaxed mb-2">{body}</p>}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2 pb-2 border-b border-border/20">
        <ImpactBadge label="Inflation" value={impacts.inflation} />
        <ImpactBadge label="Zinsen" value={impacts.rates} rateImpact />
        <ImpactBadge label="BTC" value={impacts.btc} />
      </div>
      {link && (
        <a className="text-[10px] underline text-foreground/70" href={link.url} target="_blank" rel="noreferrer">
          {link.source} · {link.date}
        </a>
      )}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {tags.map(tag => (
            <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-foreground/[0.06] text-foreground/65 border border-border/30">{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function PolicyEventGrid({ events }: { events: PolicyEventInput[] }) {
  if (events.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-500/30 bg-gradient-to-br from-amber-500/[0.04] to-orange-500/[0.02] p-4" data-testid="panel-policy-events">
      <div className="flex items-center gap-2 mb-3">
        <Flame className="w-3.5 h-3.5 text-amber-400" />
        <h2 className="text-xs font-semibold text-foreground/90">Aktuelle Key Events</h2>
        <span className="text-[10px] text-foreground/40">({events.length} aus belegten Regeln)</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {events.map(event => <PolicyEventCard key={event.id} event={event} />)}
      </div>
    </div>
  );
}

function hasHttps(evidence: { url: string }[] | undefined): boolean {
  return (evidence ?? []).some(item => /^https:\/\//i.test(item.url || ""));
}

function NoteBlock({ label, content }: { label: string; content: string }) {
  return (
    <div className="rounded-md bg-background/40 border border-border/30 p-2.5">
      <div className="text-[9px] uppercase tracking-wider text-foreground/40 mb-1">{label}</div>
      <p className="text-[11px] text-foreground/80 leading-relaxed">{content}</p>
    </div>
  );
}

function useBtcNews() {
  const [items, setItems] = useState<BtcNewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [llmAvailable, setLlmAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest("GET", "/api/analyze-btc/news", undefined, 20000);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        if (!cancelled) {
          setItems(filterBtcNewsItems(Array.isArray(json.items) ? json.items : []));
          setLlmAvailable(json.llmAvailable === true);
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Krypto-Nachrichten nicht verfügbar");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { items, loading, error, llmAvailable };
}

function BtcNewsPanel({ items, loading, error }: { items: BtcNewsItem[]; loading: boolean; error: string | null }) {
  const shown = items.filter(item => isAllowedBtcCitation(item.url, item.source));
  const bullish = shown.filter(n => n.sentiment === "bullish").length;
  const bearish = shown.filter(n => n.sentiment === "bearish").length;
  const neutral = shown.length - bullish - bearish;
  return (
    <div className="rounded-lg border border-border/50 bg-card/50 p-3" data-testid="panel-btc-news">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm">📰</span>
          <span className="text-sm font-semibold text-foreground">Aktuelle Nachrichten</span>
          {!loading && <span className="text-xs text-foreground/50">({shown.length})</span>}
        </div>
        {shown.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {bullish > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">▲ {bullish} bullish</span>}
            {bearish > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">▼ {bearish} bearish</span>}
            {neutral > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/5 text-foreground/40">● {neutral} neutral</span>}
          </div>
        )}
      </div>
      {loading && <div className="text-[11px] text-muted-foreground">Lade Nachrichten…</div>}
      {!loading && error && <div className="text-[11px] text-amber-700 dark:text-amber-400">{error}</div>}
      {!loading && !error && shown.length === 0 && (
        <div className="text-[11px] text-muted-foreground">Keine aktuellen Meldungen.</div>
      )}
      <div className="space-y-1">
        {shown.map((news, idx) => {
          const role = btcSourceRole(news.url, news.source);
          const sc = news.sentiment;
          const dotColor = sc === "bullish" ? "bg-emerald-400" : sc === "bearish" ? "bg-red-400" : "bg-foreground/30";
          const textColor = sc === "bullish" ? "text-emerald-300/90" : sc === "bearish" ? "text-red-300/90" : "text-foreground/70";
          const scoreStr = news.sentimentScore != null
            ? (news.sentimentScore > 0 ? `+${(news.sentimentScore * 100).toFixed(0)}` : `${(news.sentimentScore * 100).toFixed(0)}`)
            : "";
          return (
            <a
              key={`${news.url}-${idx}`}
              href={news.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-start gap-2 rounded-md p-1.5 hover:bg-muted/50 transition-colors cursor-pointer"
            >
              <span className={`shrink-0 mt-1 w-2 h-2 rounded-full ${dotColor}`} />
              <div className="flex-1 min-w-0">
                <p className={`text-xs leading-snug line-clamp-2 group-hover:text-primary transition-colors ${textColor}`}>
                  {news.title}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <span className="text-[10px] text-foreground/40">{news.source}</span>
                  {role && (
                    <span data-testid="news-source-role" className="text-[8px] px-1 py-px rounded bg-foreground/5 text-foreground/50">
                      {role}
                    </span>
                  )}
                  {news.lang && (
                    <span className={`text-[8px] px-1 py-px rounded font-semibold uppercase ${news.lang === "de" ? "bg-amber-500/15 text-amber-400" : "bg-blue-500/15 text-blue-400"}`}>
                      {news.lang}
                    </span>
                  )}
                  <span className="text-[10px] text-foreground/30">·</span>
                  <span className="text-[10px] text-foreground/40">{news.relativeTime}</span>
                  {scoreStr && (
                    <span className={`text-[9px] px-1 py-px rounded font-mono ${sc === "bullish" ? "bg-emerald-500/15 text-emerald-400" : sc === "bearish" ? "bg-red-500/15 text-red-400" : "bg-foreground/5 text-foreground/40"}`}>
                      {scoreStr}
                    </span>
                  )}
                </div>
              </div>
              <span className="shrink-0 text-foreground/20 group-hover:text-primary text-xs mt-0.5">↗</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

export function StablecoinLiquidityPanel() {
  const news = useBtcNews();
  const [scan, setScan] = useState<PolicyScanResponse | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const runScan = async (force: boolean) => {
    setScanning(true);
    setScanError(null);
    const maxAttempts = 3;
    let nextForce = force;
    let lastErr = "Krypto-Regulierungsanalyse nicht verfügbar";
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await apiRequest("POST", "/api/analyze-btc/policy-scan", { jurisdiction: "US", force: nextForce }, 120000);
        const json = (await res.json().catch(() => ({}))) as PolicyScanResponse & { error?: string };
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        const instruments = Array.isArray(json.instruments) ? json.instruments : [];
        const regulations = Array.isArray(json.regulations) ? json.regulations : [];
        setScan({
          ...json,
          instruments,
          regulations,
          summary: typeof json.summary === "string" ? json.summary : json.note?.summary ?? null,
          dropped: json.dropped ?? 0,
        });
        const hasBody = Boolean(json.summary || json.note?.summary || json.measured);
        if (json.error && !hasBody && instruments.length === 0 && regulations.length === 0) setScanError(json.error);
        setScanning(false);
        return;
      } catch (err: any) {
        lastErr = err?.message || lastErr;
        const retryable = /timeout|abort|network|fetch|503|504|408|499/i.test(lastErr);
        if (!retryable || attempt === maxAttempts - 1) break;
        nextForce = false;
        await new Promise(r => setTimeout(r, attempt === 0 && force ? 4000 : 3000));
      }
    }
    setScan(null);
    setScanError(lastErr);
    setScanning(false);
  };

  const llmOn = news.llmAvailable === true;
  const showAnalysis = scan != null && !scanError;
  const cited = (scan?.regulations ?? []).filter(reg => reg.confidence === "cited" && hasHttps(reg.evidence));
  const events = collectPolicyEvents(scan?.regulations ?? [], scan?.instruments ?? []);
  const note = scan?.note;

  const kiButton = (
    <button
      type="button"
      data-testid="button-policy-scan"
      disabled={scanning}
      onClick={() => runScan(true)}
      className="h-8 shrink-0 px-2.5 text-[11px] font-medium rounded-md transition-all flex items-center gap-1.5 border bg-violet-500/15 text-violet-400 border-violet-500/30 hover:bg-violet-500/25 disabled:opacity-70"
      title={llmOn ? "Makro-Notiz über OpenRouter abrufen" : "Startet den OpenRouter-Abruf. Fehlt der Schlüssel, erscheint der Fehler hier."}
    >
      {scanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
      <span>KI</span>
      {(llmOn || scanning) && <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />}
    </button>
  );

  return (
    <SectionCard number={3} title="Krypto-Liquidität" actions={kiButton}>
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Nachrichten zu Bitcoin und Krypto. Der Server misst zuerst Leitzins, Realzins,
          die 10-Jahres-Rendite, M2 und TGA über ein und zwei Jahre. Das Modell schreibt danach
          die Notiz und darf nur diese Messung zitieren.
        </p>

        <BtcNewsPanel items={news.items} loading={news.loading} error={news.error} />

        {scanning && (
          <div
            className="flex items-center gap-2 text-xs text-violet-300 bg-violet-500/10 border border-violet-500/30 rounded-md p-3"
            data-testid="text-policy-scan-loading"
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            KI-Analyse läuft…
          </div>
        )}

        {scanError && !scanning && (
          <div
            className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-md p-3"
            data-testid="text-policy-scan-error"
          >
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">KI-Analyse</div>
              <div className="mt-0.5">{scanError}</div>
            </div>
          </div>
        )}

        {!scanning && !scan && !scanError && (
          <div className="text-[11px] text-muted-foreground border border-dashed border-violet-500/30 rounded-md px-3 py-2">
            Noch keine KI-Analyse. Der violette Button startet die Notiz aus Messung und belegten Regeln.
          </div>
        )}

        {showAnalysis && scan && (
          <div className="border-t border-border/60 pt-3 space-y-3" data-testid="panel-policy-analysis">
            <div className="rounded-lg border border-border/40 bg-card/30 p-4" data-testid="panel-policy-note">
              <div className="text-[10px] text-foreground/40 uppercase tracking-wider mb-2">Makro-Notiz</div>
              <p className="text-xs text-foreground/85 leading-relaxed" data-testid="text-policy-summary">
                {note?.summary || scan.summary || "Die Analyse ist gelaufen. Eine Zusammenfassung wurde nicht geliefert."}
              </p>
              {(note?.ratesView || note?.liquidityView || note?.fiscalView) && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
                  {note?.ratesView && <NoteBlock label="Zinsen" content={note.ratesView} />}
                  {note?.liquidityView && <NoteBlock label="Liquidität" content={note.liquidityView} />}
                  {note?.fiscalView && <NoteBlock label="Fiskal & Regulierung" content={note.fiscalView} />}
                </div>
              )}
              {Array.isArray(note?.keyDrivers) && note.keyDrivers.length > 0 && (
                <div className="mt-4">
                  <div className="text-[10px] text-foreground/40 uppercase tracking-wider mb-1.5">Key Drivers</div>
                  <ul className="space-y-1">
                    {note.keyDrivers.map((driver, i) => (
                      <li key={i} className="text-[11px] text-foreground/75 flex gap-2">
                        <ChevronRight className="w-3 h-3 shrink-0 mt-0.5 text-violet-400" />
                        {driver}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {note?.btcImplication && (
                <div className="mt-3">
                  <div className="text-[10px] text-foreground/40 uppercase tracking-wider mb-1.5">Implikation für BTC</div>
                  <p className="text-[11px] text-foreground/75 leading-relaxed">{note.btcImplication}</p>
                </div>
              )}
            </div>

            <div className="text-[10px] text-muted-foreground" data-testid="text-policy-scan-meta">
              {scan.modelUsed ?? "kein Modell"}
              {" · "}
              {scan.fromCache ? "Cache" : "frisch"}
              {" · "}
              verworfen {scan.dropped}
              {" · "}
              {cited.length} belegt
            </div>

            {scan.measured && <MeasuredFredCards measured={scan.measured} />}

            {scan.error && (
              <div className="text-[11px] text-amber-700 dark:text-amber-400" data-testid="text-policy-scan-error-inline">
                {scan.error}
              </div>
            )}

            <PolicyEventGrid events={events} />

            {events.length === 0 && (
              <div className="text-[11px] text-muted-foreground" data-testid="text-policy-empty">
                Kein Instrument mit Quelle, https-Adresse und Datum.
              </div>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
