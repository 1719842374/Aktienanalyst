import { useTheme } from "@/components/ThemeProvider";
import { EarningsAmpelView } from "@/components/sections/EarningsAmpelBlock";
import { buildEarningsMarkers } from "@shared/earnings-markers";

const markers = buildEarningsMarkers([
  { date: "2024-06-30", revenueActual: 100, revenueEstimate: 100, epsActual: 1, epsEstimate: 1 },
  { date: "2024-09-30", revenueActual: 103, revenueEstimate: 100, epsActual: 1.06, epsEstimate: 1 },
  { date: "2024-12-31", revenueActual: 97, revenueEstimate: 100, epsActual: 0.94, epsEstimate: 1 },
  { date: "2025-03-31", revenueActual: 80, revenueEstimate: null, epsActual: -0.4, epsEstimate: -1 },
]).markers;

/** Fixture, keine Live-Daten. Unter 4 Umsatz-Konsensen gilt die Totzone. */
export default function EarningsAmpelPreview() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div className="min-h-screen bg-background text-foreground p-3 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground" data-testid="earnings-ampel-preview-note">Fixture zur Ansicht. Keine Live-Daten.</p>
          <button type="button" onClick={toggleTheme} className="h-8 px-3 rounded-md border border-border text-xs" data-testid="earnings-ampel-theme">{theme === "dark" ? "Light" : "Dark"}</button>
        </div>
        <EarningsAmpelView markers={markers} />
      </div>
    </div>
  );
}
