/**
 * CalibrationPage — Sprint B3 Phase 4 (interne Kalibrierungs-UI), Ticket
 * tickets/SPRINT_B3_PHASE4_CALIBRATION_UI.md, Spec WORK_SIGNAL_BACKTEST.md
 * §11 Phase 4 + §14 (Report-Vertrag).
 *
 * NUR INTERN/DEV — bewusst NICHT in der Hauptnavigation/Dashboard verlinkt
 * (Ticket Punkt 2 + Regeln: "Diese Seite darf NICHT verlinkt werden von
 * Hauptnavigation/Dashboard — bleibt 'versteckt'/intern."). Erreichbar nur
 * über die direkte Hash-Route /#/calibration (client/src/App.tsx), analog
 * zu den übrigen eigenständigen Seiten (PortfolioPage, ScreenerDashboard, ...),
 * aber ohne einen Sidebar-/Dashboard-Button.
 *
 * Zweck: Löst POST /api/backtest/run aus (server/backtest-routes.ts, bereits
 * in Phase 3 gemergt) und zeigt den zurückgegebenen CombinedBacktestReport
 * transparent an — KEIN Marketing-Chart, KEIN Marketing-Ton (Ticket-Regeln +
 * Spec §11 Phase 4 "Kein Marketing-Chart bevor Phase 3 grün" — Phase 3 lief
 * bislang nur mit kleinem Labor-Sample, das muss diese Seite sichtbar
 * machen, nicht verschleiern).
 *
 * Kernregeln (Spec §7.2-7.4 + §14 + stock-analyst-regression-guard):
 *   - Median ist IMMER die Headline-Zahl. Mean ist IMMER nur Nebenwert,
 *     niemals umgekehrt dargestellt.
 *   - status=insufficient_data wird prominent (roter Banner) angezeigt,
 *     nicht als normales Ergebnis kaschiert.
 *   - Profile-Strata: "n/a" statt 0 bei zu kleiner Stichprobe (n<8 je Seite).
 *   - Report-Text-Vorlage (§14 "Erlaubt"-Format) wird NUR gerendert, wenn
 *     genug Folds/Daten vorhanden sind (§14 "Verboten bis die Tabelle steht").
 *
 * Diese Seite selbst führt KEIN LLM aus und ruft KEIN FMP direkt auf — sie
 * ist ein reiner Client für den bereits bestehenden /api/backtest/run-
 * Endpoint (kein zweites Backtest-Modell, kein Ticker-Hardcode).
 */
import { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import { AlertTriangle, FlaskConical, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { apiRequest } from "@/lib/queryClient";

// ── Typen — bewusst als eigenständiger, lockerer Client-Spiegel des
// Server-Responses definiert (kein Import aus server/backtest/* im
// Client-Bundle — Server-Code darf nicht ins Frontend-Bundle gezogen
// werden). Feldnamen sind identisch zu server/backtest/evaluate.ts /
// cluster.ts / walkforward.ts / pit.ts, damit kein Mapping-Drift entsteht.
interface FoldDeltaLike {
  nEligibleMonths: number;
  nTotalMonths: number;
  deltaFoldMedian: number | null;
  deltaFoldMean: number | null;
}
interface HeadlineResultLike {
  nFoldsUsed: number;
  nFoldsTotal: number;
  headlineMedian: number | null;
  headlineMean: number | null;
}
interface WalkForwardFoldLike {
  foldId: number;
  lastTrainAsOf: string;
  trainLabelEnd: string;
  firstTestAsOf: string;
  testLabelEnd: string;
}
interface MonthSignalClusterLike {
  asOfMonth: string;
  signal: string | null;
  n: number;
  medianReturn: number | null;
  meanReturn: number | null;
  belowMinN: boolean;
}
interface ProfileClusterLike extends MonthSignalClusterLike {
  growthProfile: string;
}
interface MonthDeltaLike {
  asOfMonth: string;
  nAvoid: number;
  nBuy: number;
  deltaMedian: number | null;
  deltaMean: number | null;
  eligible: boolean;
}
interface T1ReportLike {
  mode: "t1_gate_lift";
  costBp: 0;
  monthDeltas: MonthDeltaLike[];
  folds: Array<{ fold: WalkForwardFoldLike; delta: FoldDeltaLike; nAvoidLike: number; status: "ok" | "insufficient_data" }>;
  headline: HeadlineResultLike;
  status: "ok" | "insufficient_data";
  minNPerMonth: number;
}
interface T2ReportLike {
  mode: "t2_signal_cohort";
  horizonDays: number;
  clusters: MonthSignalClusterLike[];
  clustersByProfile: ProfileClusterLike[];
  monthDeltas: MonthDeltaLike[];
  folds: Array<{ fold: WalkForwardFoldLike; delta: FoldDeltaLike; nAvoid: number; nBuy: number; status: "ok" | "insufficient_data" }>;
  headlineGross: HeadlineResultLike;
  costNoteByBucket: Array<{ bucket: string; costRtBp: number; entryBp: number }>;
  status: "ok" | "insufficient_data";
  minNAvoidPerFold: number;
}
interface PurgeCheckLike {
  foldId: number;
  valid: boolean;
  horizonDays: number;
  requiredPurgeDays: number;
  actualGapMonths: number;
  actualGapApproxDays: number;
  message: string;
}
interface BiasGapLike {
  gap: number;
  interpretation: string;
}
interface CombinedReportLike {
  scoringVersion: string;
  universe: string;
  horizonDays: number;
  survivorship: "naive" | "corrected";
  t1: T1ReportLike | null;
  t2: T2ReportLike | null;
  purgeChecks: PurgeCheckLike[];
  gap: BiasGapLike | null;
  generatedAt: string;
  // Sprint B3 Phase 5a (Ticket-Punkt 4): server/backtest/evaluate.ts liefert
  // coverage_T jetzt DIREKT im Report, wenn die Route selbst die Bridge
  // (buildBacktestEvents()) ausgefuehrt hat. Additiv/optional -- bei reinem
  // Event-Passthrough (t1Events/t2Events direkt im Body) bleibt das Feld
  // null, und die manuelle JSON-Eingabe unten bleibt als Fallback nutzbar.
  coverageByMonth?: CoverageRowLike[] | null;
}
interface CoverageRowLike {
  month: string;
  asOf: string;
  nUniverse: number;
  nDataComplete: number;
  coverage: number | null;
}

type RunMode = "t1" | "t2" | "t1_t2" | "t3" | "t1_t2_t3";
type Survivorship = "naive" | "corrected";

const GROWTH_PROFILES_ORDER = ["software", "cyclical", "industrial", "defensive"] as const;

function fmtPp(x: number | null | undefined, digits = 2): string {
  if (x == null || !Number.isFinite(x)) return "n/a";
  const pp = x * 100;
  return `${pp >= 0 ? "+" : ""}${pp.toFixed(digits)} pp`;
}
function fmtN(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "n/a";
  return String(x);
}
function fmtPct01(x: number | null | undefined, digits = 0): string {
  if (x == null || !Number.isFinite(x)) return "n/a";
  return `${(x * 100).toFixed(digits)}%`;
}

/**
 * Overall-Status über T1+T2 hinweg: "insufficient_data", sobald IRGENDEIN
 * angeforderter Teilreport insufficient_data meldet — bewusst konservativ
 * (Ticket: "insufficient_data MUSS prominent angezeigt werden ... NICHT
 * verschleiert"), kein Verwässern über einen gemischten Status.
 */
function overallStatus(report: CombinedReportLike | null): "ok" | "insufficient_data" | "none" {
  if (!report) return "none";
  const statuses = [report.t1?.status, report.t2?.status].filter((s): s is "ok" | "insufficient_data" => !!s);
  if (statuses.length === 0) return "none";
  return statuses.some(s => s === "insufficient_data") ? "insufficient_data" : "ok";
}

export default function CalibrationPage() {
  const [universeRaw, setUniverseRaw] = useState("");
  const [from, setFrom] = useState("2021-01-01");
  const [to, setTo] = useState("2026-06-30");
  const [horizonDays, setHorizonDays] = useState(126);
  const [mode, setMode] = useState<RunMode>("t1_t2");
  const [survivorship, setSurvivorship] = useState<Survivorship>("corrected");
  const [scoringVersion, setScoringVersion] = useState("v1");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [report, setReport] = useState<CombinedReportLike | null>(null);

  // coverage_T ist kein Feld von CombinedBacktestReport (server/backtest/pit.ts
  // liefert coverageT() als eigenständige Funktion für vom Aufrufer bereits
  // berechnete corr-Universumsergebnisse) — diese Seite bietet daher einen
  // eigenen optionalen JSON-Eingabepfad, falls ein Aufrufer bereits
  // CoverageResult[] (aus einem Skript-Lauf) mitbringt. Ohne Eingabe bleibt
  // die Tabelle leer ("keine coverage_T-Daten übergeben"), statt Werte zu
  // erfinden.
  const [coverageRaw, setCoverageRaw] = useState("");
  // Sprint B3 Phase 5a (Ticket-Punkt 4): server-seitige coverage_T (aus
  // report.coverageByMonth, wenn die Bridge lief) hat IMMER Vorrang vor der
  // manuellen JSON-Eingabe -- die JSON-Eingabe bleibt als Fallback nur fuer
  // den Fall relevant, dass coverageByMonth null ist (reiner Event-
  // Passthrough ohne Bridge).
  const coverageRows: CoverageRowLike[] | null = useMemo(() => {
    if (report?.coverageByMonth && report.coverageByMonth.length > 0) return report.coverageByMonth;
    if (!coverageRaw.trim()) return null;
    try {
      const parsed = JSON.parse(coverageRaw);
      if (Array.isArray(parsed)) return parsed as CoverageRowLike[];
      return null;
    } catch {
      return null;
    }
  }, [report, coverageRaw]);
  const coverageFromServer = !!(report?.coverageByMonth && report.coverageByMonth.length > 0);

  async function runBacktest() {
    setLoading(true);
    setError(null);
    try {
      const universe = universeRaw
        .split(/[\s,]+/)
        .map(s => s.trim().toUpperCase())
        .filter(Boolean);

      const res = await apiRequest("POST", "/api/backtest/run", {
        universe,
        from,
        to,
        horizonDays,
        mode,
        survivorship,
        scoringVersion,
        // t1Events/t2Events werden hier bewusst NICHT gesetzt — die
        // eigentliche PIT-Datenbeschaffung (replayAt()+FMP je Ticker je
        // Monat) läuft laut server/backtest-routes.ts Kommentar außerhalb
        // des HTTP-Request/Response-Zyklus (script/test-backtest-
        // feasibility.ts zeigt das Muster). Ohne t1Events/t2Events liefert
        // die Route 400 (siehe backend), was hier ehrlich als Fehler
        // angezeigt wird statt eines erfundenen Ergebnisses.
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? `HTTP ${res.status}`);
        setReport(null);
        setRunId(null);
        return;
      }
      setRunId(body.runId ?? null);
      setReport(body.report ?? null);
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setReport(null);
      setRunId(null);
    } finally {
      setLoading(false);
    }
  }

  const status = overallStatus(report);

  // Report-Text-Vorlage (§14 "Erlaubt"-Format) — NUR bei status="ok" UND
  // mindestens einem verwendeten Fold gerendert (§14 "Verboten bis die
  // Tabelle steht"). t2 hat Vorrang als Quelle der Headline-Zahl (die
  // eigentliche Avoid-Buy-Kohorte, §7 Headline-Definition); fällt darauf
  // zurück auf t1, falls nur t1 angefordert wurde.
  const headlineSource = report?.t2 ?? report?.t1 ?? null;
  const headline = headlineSource
    ? "headlineGross" in headlineSource ? headlineSource.headlineGross : headlineSource.headline
    : null;
  const canRenderReportText =
    status === "ok" &&
    headline != null &&
    headline.headlineMedian != null &&
    headline.nFoldsUsed > 0;

  const reportText = useMemo(() => {
    if (!canRenderReportText || !report || !headline) return null;
    const nFolds = headline.nFoldsUsed;
    const horizon = report.horizonDays;
    const purge = report.purgeChecks.length > 0 ? report.purgeChecks[0].requiredPurgeDays : horizon;
    const xMedian = fmtPp(headline.headlineMedian);
    const yMean = fmtPp(headline.headlineMean);
    const gapText = report.gap ? fmtPp(report.gap.gap) : "n/a (kein zweiter Lauf mit survivorship=naive vorhanden)";
    const t2 = report.t2;
    const softwareRow = t2?.clustersByProfile.find(c => c.growthProfile === "software");
    const cyclicalRow = t2?.clustersByProfile.find(c => c.growthProfile === "cyclical");
    const softwareText = softwareRow && !softwareRow.belowMinN ? fmtPp(softwareRow.medianReturn) : "n/a (n<8)";
    const cyclicalText = cyclicalRow && !cyclicalRow.belowMinN ? fmtPp(cyclicalRow.medianReturn) : "n/a (n<8)";
    return `Auf ${nFolds} Monats-Clustern, Universum PIT Cap≥1 Mrd., Horizont ${horizon}, Purge ${purge},\n` +
      `Walk-Forward ${headline.nFoldsTotal} Test-Folds, Survivorship-${report.survivorship === "corrected" ? "corr" : "naive"}:\n` +
      `Cluster-Median Δ_${horizon} Avoid−Buy = ${xMedian}\n` +
      `(Mean ${yMean}; Surv-Gap ${gapText}; software ${softwareText}; cyclical ${cyclicalText}).`;
  }, [canRenderReportText, report, headline]);

  const [copied, setCopied] = useState(false);
  async function copyReportText() {
    if (!reportText) return;
    try {
      await navigator.clipboard.writeText(reportText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard-API kann in unsicheren Kontexten fehlen — kein Fehler-Toast,
      // reine interne Seite, Text steht ohnehin sichtbar im <pre>-Block.
    }
  }

  // Monatliche Deltas (t2 bevorzugt) für die optionale Chart-Darstellung —
  // Spec Ticket Punkt 5: "einfacher Balken/Linien-Chart ... mit klarer
  // Kennzeichnung wenn n < min_n_signal_per_month".
  const monthDeltas = report?.t2?.monthDeltas ?? report?.t1?.monthDeltas ?? [];
  const minNPerMonth = 8; // §7.2 Stufe 1 — identisch zu server/backtest/cluster.ts MIN_N_SIGNAL_PER_MONTH
  const chartData = monthDeltas.map(d => ({
    month: d.asOfMonth,
    deltaPp: d.deltaMedian != null ? d.deltaMedian * 100 : null,
    eligible: d.eligible,
    nAvoid: d.nAvoid,
    nBuy: d.nBuy,
  }));

  return (
    <div className="min-h-screen bg-background text-foreground p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3 border-b border-border/50 pb-4">
        <FlaskConical className="w-6 h-6 text-muted-foreground" />
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Kalibrierungs-Diagnose (intern)</h1>
          <p className="text-xs text-muted-foreground">
            Interne Diagnose-Seite für den Signal-/Gate-Backtest (WORK_SIGNAL_BACKTEST.md §11 Phase 4).
            Nicht in der Hauptnavigation verlinkt, kein Endnutzer-Feature, keine Kaufempfehlung.
          </p>
        </div>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Diagnose-Zweck, kein Produktergebnis</AlertTitle>
        <AlertDescription>
          Diese Seite zeigt Rohergebnisse des Walk-Forward-Backtests zur internen Kalibrierung.
          Median ist die Pflicht-Hauptzahl (§7.3: Equity-Querschnitt ist rechtschief), Mean steht
          ausschließlich als Nebenwert daneben. Ergebnisse mit Status "insufficient_data" sind KEIN
          Signal und dürfen laut Spec §14 nicht als Aussage verwendet werden.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Backtest-Lauf starten</CardTitle>
          <CardDescription className="text-xs">POST /api/backtest/run — kein LLM im Run-Pfad.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Von</Label>
              <Input type="date" value={from} onChange={e => setFrom(e.target.value)} data-testid="input-calibration-from" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Bis</Label>
              <Input type="date" value={to} onChange={e => setTo(e.target.value)} data-testid="input-calibration-to" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Horizont (Handelstage)</Label>
              <Input
                type="number"
                value={horizonDays}
                onChange={e => setHorizonDays(Number(e.target.value) || 126)}
                data-testid="input-calibration-horizon"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Scoring-Version</Label>
              <Input value={scoringVersion} onChange={e => setScoringVersion(e.target.value)} data-testid="input-calibration-scoring-version" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Modus</Label>
              <Select value={mode} onValueChange={v => setMode(v as RunMode)}>
                <SelectTrigger data-testid="select-calibration-mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="t1">T1 — Gate-Lift</SelectItem>
                  <SelectItem value="t2">T2 — Signal-Kohorte</SelectItem>
                  <SelectItem value="t1_t2">T1 + T2</SelectItem>
                  <SelectItem value="t3">T3 — Policy-Portfolio</SelectItem>
                  <SelectItem value="t1_t2_t3">T1 + T2 + T3</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Survivorship</Label>
              <Select value={survivorship} onValueChange={v => setSurvivorship(v as Survivorship)}>
                <SelectTrigger data-testid="select-calibration-survivorship"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="corrected">corrected (PIT-Universum)</SelectItem>
                  <SelectItem value="naive">naive (Survivor-only)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Universum (Ticker, Komma/Leerzeichen-getrennt — optional)</Label>
              <Input
                value={universeRaw}
                onChange={e => setUniverseRaw(e.target.value)}
                placeholder="z.B. aus script/test-backtest-feasibility.ts Lauf übernehmen"
                data-testid="input-calibration-universe"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">t1Events / t2Events (optional, JSON-Array — Route benötigt mind. eines der beiden)</Label>
            <p className="text-[11px] text-muted-foreground">
              Diese Route führt bewusst NUR die Cluster-/Walk-Forward-Aggregation aus (kein FMP-Call, kein LLM
              im Request selbst). Bereits berechnete Ereignisse (z.B. Export aus einem Skript-Lauf wie
              script/test-backtest-feasibility.ts) müssen hier eingefügt werden — sonst antwortet der Server
              mit 400 (keine Ereignisse übergeben), was unten ehrlich als Fehler angezeigt wird.
            </p>
          </div>

          <Button onClick={runBacktest} disabled={loading} data-testid="button-run-backtest">
            {loading ? "Läuft…" : "Backtest-Lauf starten"}
          </Button>

          {error && (
            <Alert variant="destructive" data-testid="alert-backtest-error">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Lauf fehlgeschlagen</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {report && (
        <>
          {status === "insufficient_data" && (
            <Alert variant="destructive" data-testid="banner-insufficient-data">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>STATUS: insufficient_data</AlertTitle>
              <AlertDescription>
                Mindestens ein Teilreport hat in mindestens einem Fold zu wenig Ereignisse
                (n_Avoid/Fold &lt; {report.t2?.minNAvoidPerFold ?? report.t1?.minNPerMonth ?? 80}).
                Die Headline-Zahl unten ist KEIN belastbares Ergebnis und darf laut Spec §14
                nicht als Kunden- oder Marketingaussage verwendet werden — reine interne
                Kalibrierungs-Diagnose.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Card data-testid="card-headline-median">
              <CardContent className="pt-4">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Headline (PFLICHT) — Median Δ Avoid−Buy</div>
                <div className="text-2xl font-bold tabular-nums mt-1">{fmtPp(headline?.headlineMedian)}</div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  Folds genutzt: {headline?.nFoldsUsed ?? 0}/{headline?.nFoldsTotal ?? 0}
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-mean-secondary">
              <CardContent className="pt-4">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Nebenwert — Mean (NIE Headline)</div>
                <div className="text-lg font-semibold tabular-nums mt-1 text-muted-foreground">{fmtPp(headline?.headlineMean)}</div>
                <div className="text-[10px] text-muted-foreground mt-1">Nur „was wäre aus 1€ geworden“-Lesart, §7.4</div>
              </CardContent>
            </Card>
            <Card data-testid="card-gap">
              <CardContent className="pt-4">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Survivorship-Gap (naive − corr)</div>
                <div className="text-lg font-semibold tabular-nums mt-1">{report.gap ? fmtPp(report.gap.gap) : "n/a"}</div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {report.gap ? report.gap.interpretation : "Kein zweiter Lauf mit survivorship=naive übergeben — Gap erfordert zwei Runs."}
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-status">
              <CardContent className="pt-4">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Status</div>
                <Badge
                  variant={status === "ok" ? "default" : "destructive"}
                  className="mt-1"
                  data-testid="badge-overall-status"
                >
                  {status}
                </Badge>
                <div className="text-[10px] text-muted-foreground mt-1">
                  scoringVersion={report.scoringVersion}, horizonDays={report.horizonDays}, survivorship={report.survivorship}
                </div>
              </CardContent>
            </Card>
          </div>

          {runId && <div className="text-[10px] text-muted-foreground">runId: {runId} — generatedAt: {report.generatedAt}</div>}

          {report.t2 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">T2 Signal-Kohorte — Stichprobengröße je Fold</CardTitle>
                <CardDescription className="text-xs">n_Avoid/n_Buy pro Fold; min_n_avoid_per_fold = {report.t2.minNAvoidPerFold}</CardDescription>
              </CardHeader>
              <CardContent>
                <Table data-testid="table-t2-folds">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fold</TableHead>
                      <TableHead>Test-Zeitraum</TableHead>
                      <TableHead>n Avoid</TableHead>
                      <TableHead>n Buy</TableHead>
                      <TableHead>Δ_Fold Median</TableHead>
                      <TableHead>Δ_Fold Mean</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.t2.folds.map(f => (
                      <TableRow key={f.fold.foldId}>
                        <TableCell>{f.fold.foldId}</TableCell>
                        <TableCell className="text-xs">{f.fold.firstTestAsOf} – {f.fold.testLabelEnd}</TableCell>
                        <TableCell className="tabular-nums">{fmtN(f.nAvoid)}</TableCell>
                        <TableCell className="tabular-nums">{fmtN(f.nBuy)}</TableCell>
                        <TableCell className="tabular-nums">{fmtPp(f.delta.deltaFoldMedian)}</TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">{fmtPp(f.delta.deltaFoldMean)}</TableCell>
                        <TableCell>
                          <Badge variant={f.status === "ok" ? "default" : "destructive"}>{f.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {report.t1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">T1 Gate-Lift — Stichprobengröße je Fold</CardTitle>
                <CardDescription className="text-xs">min_n_per_month = {report.t1.minNPerMonth}, Kosten = 0bp (§8.1)</CardDescription>
              </CardHeader>
              <CardContent>
                <Table data-testid="table-t1-folds">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fold</TableHead>
                      <TableHead>Test-Zeitraum</TableHead>
                      <TableHead>n Gate-aktiv-ähnlich</TableHead>
                      <TableHead>Δ_Fold Median</TableHead>
                      <TableHead>Δ_Fold Mean</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.t1.folds.map(f => (
                      <TableRow key={f.fold.foldId}>
                        <TableCell>{f.fold.foldId}</TableCell>
                        <TableCell className="text-xs">{f.fold.firstTestAsOf} – {f.fold.testLabelEnd}</TableCell>
                        <TableCell className="tabular-nums">{fmtN(f.nAvoidLike)}</TableCell>
                        <TableCell className="tabular-nums">{fmtPp(f.delta.deltaFoldMedian)}</TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">{fmtPp(f.delta.deltaFoldMean)}</TableCell>
                        <TableCell>
                          <Badge variant={f.status === "ok" ? "default" : "destructive"}>{f.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {report.t2 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Profile-Strata (§7.5)</CardTitle>
                <CardDescription className="text-xs">
                  Median-Return je GrowthProfile-Cluster; "n/a" statt 0 wenn eine Seite (Avoid ODER Buy) n&lt;8.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table data-testid="table-profile-strata">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Profil</TableHead>
                      <TableHead>Monat</TableHead>
                      <TableHead>Signal</TableHead>
                      <TableHead>n</TableHead>
                      <TableHead>Median-Return</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.t2.clustersByProfile.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-xs">Keine Profile-Strata-Daten im Report (kein growthProfile auf den Events gesetzt).</TableCell></TableRow>
                    )}
                    {[...report.t2.clustersByProfile]
                      .sort((a, b) =>
                        GROWTH_PROFILES_ORDER.indexOf(a.growthProfile as any) - GROWTH_PROFILES_ORDER.indexOf(b.growthProfile as any) ||
                        a.asOfMonth.localeCompare(b.asOfMonth)
                      )
                      .map((c, i) => (
                        <TableRow key={`${c.growthProfile}-${c.asOfMonth}-${c.signal}-${i}`}>
                          <TableCell>{c.growthProfile}</TableCell>
                          <TableCell className="text-xs">{c.asOfMonth}</TableCell>
                          <TableCell>{c.signal}</TableCell>
                          <TableCell className="tabular-nums">{fmtN(c.n)}</TableCell>
                          <TableCell className="tabular-nums">{c.belowMinN ? "n/a (n<8)" : fmtPp(c.medianReturn)}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">coverage_T pro Monat</CardTitle>
              <CardDescription className="text-xs">
                coverage_T = #dataComplete im PIT-Universum / #U_corr(T) (§5.4).{" "}
                {coverageFromServer
                  ? "Direkt vom Server übernommen (Bridge lief für diesen Run)."
                  : "Diese Antwort enthält kein server-seitiges coverageByMonth (reiner Event-Passthrough) — optional als CoverageResult[]-JSON aus einem Skript-Lauf einfügen."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                value={coverageRaw}
                onChange={e => setCoverageRaw(e.target.value)}
                disabled={coverageFromServer}
                placeholder='z.B. [{"month":"2023-01","asOf":"2023-01-31","nUniverse":520,"nDataComplete":498,"coverage":0.958}]'
                data-testid="input-coverage-json"
              />
              {coverageRows ? (
                <Table data-testid="table-coverage-t">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Monat</TableHead>
                      <TableHead>as-of</TableHead>
                      <TableHead>n Universum</TableHead>
                      <TableHead>n dataComplete</TableHead>
                      <TableHead>coverage_T</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {coverageRows.map((r, i) => (
                      <TableRow key={`${r.month}-${i}`}>
                        <TableCell>{r.month}</TableCell>
                        <TableCell className="text-xs">{r.asOf}</TableCell>
                        <TableCell className="tabular-nums">{fmtN(r.nUniverse)}</TableCell>
                        <TableCell className="tabular-nums">{fmtN(r.nDataComplete)}</TableCell>
                        <TableCell className="tabular-nums">{fmtPct01(r.coverage)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-xs text-muted-foreground">Keine coverage_T-Daten übergeben (weder vom Server noch per JSON-Eingabe).</div>
              )}
            </CardContent>
          </Card>

          {chartData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Monatliche Deltas δ_t (Avoid−Buy, Median)</CardTitle>
                <CardDescription className="text-xs">
                  Rein diagnostisch, kein Marketing-Chart (§11 Phase 4). Balken mit n&lt;{minNPerMonth} auf einer Seite
                  sind grau markiert (δ_t=null, nicht gerendert als 0).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} data-testid="chart-monthly-deltas">
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} label={{ value: "pp", angle: -90, position: "insideLeft", fontSize: 10 }} />
                    <Tooltip
                      formatter={(value: any, _name: any, item: any) => {
                        if (value == null) return ["n/a (nicht eligible)", ""];
                        return [`${Number(value).toFixed(2)} pp (n_Avoid=${item.payload.nAvoid}, n_Buy=${item.payload.nBuy})`, "δ_t Median"];
                      }}
                    />
                    <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.3} />
                    <Bar dataKey="deltaPp" data-testid="bar-monthly-delta">
                      {chartData.map((d, i) => (
                        <Cell key={i} fill={!d.eligible ? "#9ca3af" : (d.deltaPp ?? 0) >= 0 ? "#f87171" : "#34d399"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="text-[10px] text-muted-foreground mt-1">Grau = insufficient_data für diesen Monat (n_Avoid oder n_Buy &lt; {minNPerMonth}).</div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Report-Text-Vorlage (§14 „Erlaubt“-Format)</CardTitle>
              <CardDescription className="text-xs">Copy-Paste-fähig für spätere Nutzung — kein Marketing-Ton.</CardDescription>
            </CardHeader>
            <CardContent>
              {canRenderReportText && reportText ? (
                <div className="space-y-2">
                  <pre className="text-xs bg-muted/30 border border-border/50 rounded-md p-3 whitespace-pre-wrap" data-testid="text-report-template">
                    {reportText}
                  </pre>
                  <Button size="sm" variant="outline" onClick={copyReportText} data-testid="button-copy-report-text">
                    {copied ? "Kopiert" : "In Zwischenablage kopieren"}
                  </Button>
                </div>
              ) : (
                <Alert data-testid="alert-report-text-blocked">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Text-Vorlage gesperrt</AlertTitle>
                  <AlertDescription>
                    Status ist {status === "none" ? "kein Lauf" : status} bzw. es liegt keine genutzte Fold-Headline vor.
                    Laut Spec §14 ("Verboten bis die Tabelle steht") wird der Report-Satz erst generiert, wenn
                    status=ok UND mindestens ein Fold in die Headline eingeht — sonst würde eine nicht belastbare
                    Zahl wie ein fertiges Ergebnis aussehen.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Purge-Validierung je Fold</CardTitle>
            </CardHeader>
            <CardContent>
              <Table data-testid="table-purge-checks">
                <TableHeader>
                  <TableRow>
                    <TableHead>Fold</TableHead>
                    <TableHead>Gültig</TableHead>
                    <TableHead>Abstand (Monate)</TableHead>
                    <TableHead>Nachricht</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.purgeChecks.map(p => (
                    <TableRow key={p.foldId}>
                      <TableCell>{p.foldId}</TableCell>
                      <TableCell><Badge variant={p.valid ? "default" : "destructive"}>{p.valid ? "ok" : "LEAKAGE"}</Badge></TableCell>
                      <TableCell className="tabular-nums">{p.actualGapMonths}</TableCell>
                      <TableCell className="text-xs">{p.message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
