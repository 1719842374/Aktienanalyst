import { useTheme } from "@/components/ThemeProvider";
import { EarningsAmpelView } from "@/components/sections/EarningsAmpelBlock";
import { buildEarningsAmpel } from "@shared/earnings-ampel";
import type { EarningsMarker } from "@shared/earnings-markers";

const FIXTURE: EarningsMarker[] = [
  {
    date: "2024-06-30",
    kind: "inline",
    reason: null,
    basis: "revenue",
    revenueActual: 100,
    revenueEstimate: 100,
    revenueSurprisePct: 0,
    epsActual: 1,
    epsEstimate: 1,
    epsSurprisePct: 0,
  },
  {
    date: "2024-09-30",
    kind: "beat",
    reason: null,
    basis: "revenue",
    revenueActual: 103,
    revenueEstimate: 100,
    revenueSurprisePct: 3,
    epsActual: 1.06,
    epsEstimate: 1,
    epsSurprisePct: 6,
  },
  {
    date: "2024-12-31",
    kind: "miss",
    reason: null,
    basis: "revenue",
    revenueActual: 97,
    revenueEstimate: 100,
    revenueSurprisePct: -3,
    epsActual: 0.94,
    epsEstimate: 1,
    epsSurprisePct: -6,
  },
  {
    date: "2025-03-31",
    kind: null,
    reason: "n/a — Schätzung fehlt oder ist 0, keine Surprise",
    basis: null,
    revenueActual: 80,
    revenueEstimate: null,
    revenueSurprisePct: null,
    epsActual: null,
    epsEstimate: 1.2,
    epsSurprisePct: null,
  },
];

/** Fixture-Ansicht der Ampel, ohne /api/analyze und ohne erfundene Live-Zahlen. */
export default function EarningsAmpelPreview() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div className="min-h-screen bg-background text-foreground p-3 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground break-words" data-testid="earnings-ampel-preview-note">
            Fixture zur Ansicht. Keine Live-Daten.
          </p>
          <button type="button" onClick={toggleTheme} className="h-8 px-3 rounded-md border border-border text-xs" data-testid="earnings-ampel-theme">
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        </div>
        <EarningsAmpelView model={buildEarningsAmpel(FIXTURE)} notice={null} />
      </div>
    </div>
  );
}
