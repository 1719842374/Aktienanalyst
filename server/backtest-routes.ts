/**
 * server/backtest-routes.ts — Sprint B3 Phase 3 (T1/T2 Cluster + Walk-
 * Forward), WORK_SIGNAL_BACKTEST.md §12 "API-Vertrag" + Ticket Punkt 6+7.
 *
 * NEUE, ADDITIVE Route-Datei (analog server/screener.ts / server/gold-
 * routes.ts) — wird laut stock-analyst-regression-guard NUR am ENDE von
 * server/routes.ts registriert (dynamischer Import, wie
 * registerScreenerRoute). Diese Datei selbst fasst KEINE bestehende Route
 * an.
 *
 * KEIN LLM im Run-Pfad. KEINE Ticker-Hardcodes — der Aufrufer uebergibt
 * `universe` als Parameter (z.B. eine Ticker-Liste, die selbst aus FMP
 * abgeleitet wurde — siehe script/feasibility-backtest.ts fuer ein
 * Beispiel, das allKnownSp500Symbols() aus universe.ts nutzt statt einer
 * Liste im Code).
 *
 * Phase 3 baut NUR T1 (Gate-Lift) und T2 (Signal-Kohorte). T3
 * (Policy-Portfolio) ist Phase 5 und wird hier bewusst NICHT beantwortet
 * (mode="t3" liefert 501 not_implemented, kein Fake-Ergebnis).
 *
 * Persistenz: In-Memory-Report-Store (Map<runId, CombinedBacktestReport>).
 * Das ist bewusst einfach gehalten (kein neues SQLite-Schema fuer dieses
 * Ticket) — ein Prozess-Neustart verliert gespeicherte Runs, was fuer
 * Phase 3 (Feasibility, keine Produktionslast) akzeptabel ist. Phase 4/5
 * kann bei Bedarf auf snapshot-store.ts-Muster (SQLite) umstellen.
 */
import type { Express, Request, Response } from "express";
import { randomUUID } from "crypto";
import { WF_V1_FOLDS, DEFAULT_PITCH_HORIZON_DAYS, type WalkForwardFold } from "./backtest/walkforward";
import {
  evaluateT1GateLift,
  evaluateT2SignalCohort,
  buildCombinedReport,
  type GateLiftEvent,
  type CombinedBacktestReport,
} from "./backtest/evaluate";
import type { SignalReturnEvent } from "./backtest/cluster";

const reportStore = new Map<string, CombinedBacktestReport>();

interface RunBacktestBody {
  universe?: string[];
  from?: string;
  to?: string;
  horizonDays?: number;
  mode?: "t1" | "t2" | "t1_t2";
  survivorship?: "naive" | "corrected";
  scoringVersion?: string;
  /** Bereits extern berechnete Ereignisse (Aufrufer hat replayAt() +
   *  deriveSignalV1() + forwardReturn() bereits ausgefuehrt — diese Route
   *  fuehrt NUR die Cluster-/Walk-Forward-Aggregation aus, kein zweites
   *  Scoring-Modell). Additiv, weil die volle Live-Datenbeschaffung
   *  (Financials je Ticker je Monat) ausserhalb des Request-Response-
   *  Zyklus laufen sollte (script/feasibility-backtest.ts zeigt das
   *  Muster) — die Route selbst bleibt reine Aggregation+Report. */
  t2Events?: SignalReturnEvent[];
  t1Events?: GateLiftEvent[];
}

/**
 * registerBacktestRoutes() — additive Registrierung, analog
 * registerScreenerRoute()/registerGoldRoutes(). Wird NUR am Dateiende von
 * server/routes.ts aufgerufen (append-only-Regel).
 */
export function registerBacktestRoutes(app: Express): void {
  /**
   * POST /api/backtest/run
   * Body: { universe, from, to, horizonDays, mode, survivorship,
   *         scoringVersion, t1Events?, t2Events? }
   *
   * Fuehrt die Cluster-/Walk-Forward-Aggregation (cluster.ts/walkforward.ts/
   * evaluate.ts) auf bereits extern bereitgestellten Signal+Return-
   * Ereignissen aus (t1Events/t2Events) und persistiert das Ergebnis unter
   * einer runId. KEIN LLM, KEIN Live-FMP-Call in dieser Route selbst — die
   * Datenbeschaffung (replayAt + FMP) passiert in einem separaten Schritt
   * (Skript oder ein spaeterer Orchestrierungs-Endpoint), damit ein
   * einzelner HTTP-Request nicht Hunderte FMP-Calls blockierend ausloest
   * (dasselbe Vorsichtsprinzip wie screener.ts MAX_SCREENED_TICKERS).
   */
  app.post("/api/backtest/run", (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as RunBacktestBody;
      const horizonDays = body.horizonDays ?? DEFAULT_PITCH_HORIZON_DAYS;
      const survivorship = body.survivorship ?? "corrected";
      const scoringVersion = body.scoringVersion ?? "v1";
      const mode = body.mode ?? "t1_t2";
      const universeLabel =
        Array.isArray(body.universe) && body.universe.length > 0
          ? `${body.universe.length} Ticker (extern uebergeben)`
          : "unspezifiziert";

      if (mode !== "t1" && mode !== "t2" && mode !== "t1_t2") {
        return res.status(400).json({ error: "mode muss 't1', 't2' oder 't1_t2' sein (t3 ist Phase 5, hier nicht implementiert)" });
      }

      const folds: WalkForwardFold[] = WF_V1_FOLDS;

      const t1Report =
        (mode === "t1" || mode === "t1_t2") && Array.isArray(body.t1Events)
          ? evaluateT1GateLift(body.t1Events, folds)
          : null;

      const t2Report =
        (mode === "t2" || mode === "t1_t2") && Array.isArray(body.t2Events)
          ? evaluateT2SignalCohort(body.t2Events, horizonDays, { folds })
          : null;

      if (!t1Report && !t2Report) {
        return res.status(400).json({
          error: "Keine Ereignisse uebergeben (t1Events/t2Events fehlen) oder mode passt nicht zu den uebergebenen Feldern.",
        });
      }

      const report = buildCombinedReport({
        scoringVersion,
        universe: universeLabel,
        horizonDays,
        survivorship,
        t1: t1Report,
        t2: t2Report,
        folds,
        naiveHeadlineMedian: null, // Gap-Berechnung erfordert einen zweiten Lauf mit survivorship="naive" — Aufrufer kann beide Runs separat erzeugen und gap clientseitig/als Folgeschritt berechnen (Phase 3 baut keinen automatischen Doppel-Lauf).
        corrHeadlineMedian: t2Report?.headlineGross.headlineMedian ?? t1Report?.headline.headlineMedian ?? null,
      });

      const runId = randomUUID();
      reportStore.set(runId, report);

      return res.json({ runId, report });
    } catch (err: any) {
      console.warn(`[BACKTEST] /api/backtest/run failed: ${err?.message?.substring(0, 200)}`);
      return res.status(500).json({ error: "Backtest-Run fehlgeschlagen", detail: String(err?.message ?? err) });
    }
  });

  /**
   * GET /api/backtest/report?runId=...
   * Liefert den zuvor unter POST /api/backtest/run gespeicherten Report
   * (FoldResult[] + Headline Δ_med/Δ_mean + gap + coverage + strata, §12).
   */
  app.get("/api/backtest/report", (req: Request, res: Response) => {
    const runId = String(req.query.runId ?? "");
    if (!runId) return res.status(400).json({ error: "runId Query-Parameter fehlt" });

    const report = reportStore.get(runId);
    if (!report) return res.status(404).json({ error: "Kein Report unter dieser runId gefunden (Prozess-Neustart oder falsche runId?)" });

    return res.json(report);
  });
}
