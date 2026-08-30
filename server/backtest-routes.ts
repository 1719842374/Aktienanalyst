/**
 * server/backtest-routes.ts — Sprint B3 Phase 3 (T1/T2 Cluster + Walk-
 * Forward), WORK_SIGNAL_BACKTEST.md §12 "API-Vertrag" + Ticket Punkt 6+7;
 * erweitert um Sprint B3 Phase 5a+5b (SPRINT_B3_PHASE5_T3_POLICY.md).
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
 * Phase 3 baute NUR T1 (Gate-Lift) und T2 (Signal-Kohorte) auf extern
 * uebergebenen Events. Phase 5a (dieser Stand) schliesst zusaetzlich die
 * Datenerhebungs-Bridge: fehlen t1Events/t2Events im Body, aber sind
 * universe/from/to vorhanden, ruft die Route selbst
 * buildBacktestEvents() (build-events.ts) auf. Phase 5b ergaenzt
 * mode="t3" (T3 Policy-Portfolio, server/backtest/t3-policy.ts) fuer
 * extern uebergebene Signal-Zeitreihen (t3Signals).
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
  evaluateT3Policy,
  buildCombinedReport,
  type GateLiftEvent,
  type CombinedBacktestReport,
  type T3TickerSignalAtQuarter,
} from "./backtest/evaluate";
import type { SignalReturnEvent } from "./backtest/cluster";
import { buildBacktestEvents } from "./backtest/build-events";

const reportStore = new Map<string, CombinedBacktestReport>();

interface RunBacktestBody {
  universe?: string[];
  from?: string;
  to?: string;
  horizonDays?: number;
  mode?: "t1" | "t2" | "t1_t2" | "t3" | "t1_t2_t3";
  survivorship?: "naive" | "corrected";
  scoringVersion?: string;
  /** Bereits extern berechnete Ereignisse (Aufrufer hat replayAt() +
   *  deriveSignalV1() + forwardReturn() bereits ausgefuehrt — diese Route
   *  fuehrt NUR die Cluster-/Walk-Forward-Aggregation aus, kein zweites
   *  Scoring-Modell). Additiv, weil die volle Live-Datenbeschaffung
   *  (Financials je Ticker je Monat) ausserhalb des Request-Response-
   *  Zyklus laufen sollte (script/feasibility-backtest.ts zeigt das
   *  Muster) — die Route selbst bleibt reine Aggregation+Report.
   *
   *  Sprint B3 Phase 5a (Ticket Teil 5a): WENN t1Events/t2Events FEHLEN,
   *  aber universe/from/to VORHANDEN sind, ruft die Route selbst
   *  buildBacktestEvents() (build-events.ts) auf, um sie herzuleiten —
   *  Angabe von t1Events/t2Events bleibt weiterhin abwaertskompatibel
   *  moeglich (nimmt dann Vorrang, keine erneute Datenbeschaffung). */
  t2Events?: SignalReturnEvent[];
  t1Events?: GateLiftEvent[];
  /** Sprint B3 Phase 5b: Signal-Zeitreihe fuer die T3-Policy-Simulation
   *  (ein Array pro Quartalsende, siehe T3TickerSignalAtQuarter in
   *  t3-policy.ts). Analog t1Events/t2Events extern vom Aufrufer
   *  bereitgestellt — diese Route fuehrt darauf NUR die
   *  Portfolio-Simulation (simulateT3Policy) aus, kein Live-FMP-Call. */
  t3Signals?: T3TickerSignalAtQuarter[][];
  /** Obergrenze fuer die pro Monat via buildBacktestEvents() betrachteten
   *  Ticker (Kostenschutz fuer Request-Response-Zyklus, siehe
   *  build-events.ts DEFAULT_MAX_TICKERS_PER_MONTH). */
  maxTickersPerMonth?: number;
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
   *         scoringVersion, t1Events?, t2Events?, t3Signals?,
   *         maxTickersPerMonth? }
   *
   * Fuehrt die Cluster-/Walk-Forward-Aggregation (cluster.ts/walkforward.ts/
   * evaluate.ts) auf Signal+Return-Ereignissen aus und persistiert das
   * Ergebnis unter einer runId.
   *
   * Zwei Wege zu den T1/T2-Events (Ticket Teil 5a, abwaertskompatibel):
   *   (a) direkt im Body (t1Events/t2Events) -- wie bisher, Vorrang.
   *   (b) NUR universe/from/to im Body -- die Route ruft selbst
   *       buildBacktestEvents() (build-events.ts) auf und leitet die
   *       Events + coverageByMonth (§5.4) daraus ab.
   *
   * mode="t3"|"t1_t2_t3" (Ticket Teil 5b): simuliert das T3
   * Policy-Portfolio (server/backtest/t3-policy.ts) auf der extern
   * uebergebenen Signal-Zeitreihe `t3Signals` (kein Live-FMP-Call fuer T3
   * in dieser Route -- die Zeitreihe inkl. Marktkap./Forward-Return muss
   * der Aufrufer bereitstellen).
   *
   * KEIN LLM in dieser Route. buildBacktestEvents() macht die noetigen
   * FMP-Calls asynchron innerhalb des Requests, begrenzt durch
   * maxTickersPerMonth (Vorsichtsprinzip analog screener.ts
   * MAX_SCREENED_TICKERS).
   */
  app.post("/api/backtest/run", async (req: Request, res: Response) => {
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

      const VALID_MODES = ["t1", "t2", "t1_t2", "t3", "t1_t2_t3"] as const;
      if (!VALID_MODES.includes(mode as any)) {
        return res.status(400).json({ error: "mode muss 't1', 't2', 't1_t2', 't3' oder 't1_t2_t3' sein" });
      }

      const folds: WalkForwardFold[] = WF_V1_FOLDS;

      const needsT1T2 = mode === "t1" || mode === "t2" || mode === "t1_t2" || mode === "t1_t2_t3";
      const wantsT1 = mode === "t1" || mode === "t1_t2" || mode === "t1_t2_t3";
      const wantsT2 = mode === "t2" || mode === "t1_t2" || mode === "t1_t2_t3";
      const wantsT3 = mode === "t3" || mode === "t1_t2_t3";

      // Sprint B3 Phase 5a (Ticket Teil 5a, Datenerhebungs-Bridge): wenn
      // t1Events/t2Events NICHT direkt uebergeben wurden, aber
      // universe/from/to vorhanden sind, holt die Route selbst die
      // Rohdaten via buildBacktestEvents() (build-events.ts). Direkte
      // Uebergabe von t1Events/t2Events bleibt unveraendert moeglich und
      // hat Vorrang (keine erneute Datenbeschaffung, volle
      // Abwaertskompatibilitaet gemaess Ticket Punkt 3).
      let t1Events = body.t1Events;
      let t2Events = body.t2Events;
      let coverageByMonth: import("./backtest/pit").CoverageResult[] | null = null;

      const hasDirectEvents = Array.isArray(body.t1Events) || Array.isArray(body.t2Events);
      const canBridge = !hasDirectEvents && Array.isArray(body.universe) && body.universe.length > 0 && !!body.from && !!body.to;

      if (needsT1T2 && !hasDirectEvents && canBridge) {
        const bridged = await buildBacktestEvents({
          universe: body.universe,
          from: body.from as string,
          to: body.to as string,
          horizonDays,
          survivorship,
          maxTickersPerMonth: body.maxTickersPerMonth,
        });
        t1Events = bridged.t1Events;
        t2Events = bridged.t2Events;
        coverageByMonth = bridged.coverageByMonth;
      }

      const t1Report = wantsT1 && Array.isArray(t1Events) ? evaluateT1GateLift(t1Events, folds) : null;

      const t2Report = wantsT2 && Array.isArray(t2Events) ? evaluateT2SignalCohort(t2Events, horizonDays, { folds }) : null;

      // Sprint B3 Phase 5b: T3-Policy-Portfolio -- Signal-Zeitreihe kommt
      // ausschliesslich per direkter Uebergabe (t3Signals), da die
      // Portfolio-Simulation Quartals-Cap-/Preis-Daten je Ticker benoetigt,
      // die buildBacktestEvents() (Monatsraster, T1/T2-Events) nicht in der
      // fuer T3 benoetigten Form liefert (kein Herleiten/Raten hier).
      const t3Report = wantsT3 && Array.isArray(body.t3Signals) ? evaluateT3Policy(body.t3Signals) : null;

      if (!t1Report && !t2Report && !t3Report) {
        return res.status(400).json({
          error:
            "Keine Ereignisse verfuegbar: weder t1Events/t2Events/t3Signals direkt uebergeben, noch universe+from+to fuer die Bridge (buildBacktestEvents) vorhanden/passend zum mode.",
        });
      }

      const report = buildCombinedReport({
        scoringVersion,
        universe: universeLabel,
        horizonDays,
        survivorship,
        t1: t1Report,
        t2: t2Report,
        t3: t3Report,
        folds,
        naiveHeadlineMedian: null, // Gap-Berechnung erfordert einen zweiten Lauf mit survivorship="naive" — Aufrufer kann beide Runs separat erzeugen und gap clientseitig/als Folgeschritt berechnen (Phase 3 baut keinen automatischen Doppel-Lauf).
        corrHeadlineMedian: t2Report?.headlineGross.headlineMedian ?? t1Report?.headline.headlineMedian ?? null,
        coverageByMonth,
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
