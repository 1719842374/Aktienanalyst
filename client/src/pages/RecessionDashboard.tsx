import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { ChatWidget } from "@/components/chat/ChatWidget";
import { buildRecessionChatContext } from "@shared/chat-context";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { RECESSION_FALLBACK_DATA } from "@/lib/recessionFallbackData";
import { useTheme } from "@/components/ThemeProvider";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { SectionCard } from "@/components/SectionCard";
import { RecessionRsiSection } from "@/components/recession/RecessionRsiSection";
import { BuffettRatioPanel } from "@/components/recession/BuffettRatioPanel";
import { SahmRegions } from "@/components/recession/SahmRegions";
import { RecessionMarketChartsSection } from "@/components/recession/RecessionMarketChartsSection";
import { RecessionTaSection } from "@/components/recession/RecessionTaSection";
import { useLocation } from "wouter";
import { Sun, Moon, AlertTriangle, ArrowLeft } from "lucide-react";
import { showRecessionStand, type RecessionAnalysis } from "@/components/recession/recessionDashboardShared";
import { RegionalCatalogSection } from "@/components/recession/RegionalCatalogSection";
import { useRecessionCatalog } from "@/hooks/useRecessionCatalog";
import { RegionGaugeSwitch } from "@/components/recession/RegionGaugeSwitch";
import {
  WelcomeScreen, LoadingScreen, ErrorScreen,
  NYFedReference, ScoringRules, ScoringZones,
} from "@/components/recession/recessionDashboardPartsA";
import {
  IndicatorTable, SubgroupOverview, ProbabilityEstimates,
  Summary, FazitSection, SourcesList,
} from "@/components/recession/recessionDashboardPartsB";

export default function RecessionDashboard() {
  const { theme, toggleTheme } = useTheme();
  const [, navigate] = useLocation();
  const [data, setData] = useState<RecessionAnalysis | null>(null);

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      try {
        for (let attempt = 0; attempt < 4; attempt++) {
          const res = await apiRequest("POST", "/api/analyze-recession", {});
          const json = await res.json();
          if (json?.__building) {
            await new Promise(resolve => setTimeout(resolve, json.retryAfterMs ?? 9000));
            continue;
          }
          if (!json || !json.indicators || !Array.isArray(json.indicators)) {
            throw new Error("Invalid response format");
          }
          return json as RecessionAnalysis;
        }
        throw new Error("Recession analysis still building");
      } catch {
        return RECESSION_FALLBACK_DATA as RecessionAnalysis;
      }
    },
    onSuccess: (result) => {
      setData(result);
    },
  });

  const regions = useRecessionCatalog(data);

  // Chat-Widget (PR 2, additiv): Kontext nur aus den bereits geladenen Rezessionsdaten.
  // Sektionen tragen keine Refs; Bindung und Sprung laufen über data-testid="section-N" der SectionCard.
  const mainRef = useRef<HTMLElement>(null);
  const chatContext = useMemo(() => (data ? buildRecessionChatContext(data, { hasRegions: !!regions }) : null), [data, regions]);
  const chatSections = useMemo(() => (chatContext?.sections ?? []).map(({ id, label }) => ({ id, label })), [chatContext]);
  const sectionEl = useCallback((id: number) => mainRef.current?.querySelector<HTMLElement>(`[data-testid="section-${id}"]`) ?? null, []);
  const jumpToSection = useCallback((id: number) => {
    sectionEl(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [sectionEl]);
  const getActiveSectionId = useCallback((): number | null => {
    const top = mainRef.current?.getBoundingClientRect().top ?? 0;
    for (const { id } of chatSections) {
      const el = sectionEl(id);
      if (!el) continue;
      if (el.getBoundingClientRect().bottom > top + 40) return id;
    }
    return null;
  }, [chatSections, sectionEl]);

  const startAnalysis = useCallback(() => {
    analyzeMutation.mutate();
  }, [analyzeMutation]);

  useEffect(() => {
    startAnalysis();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      <header className="flex-shrink-0 h-12 border-b border-border bg-card flex items-center justify-between px-3 sm:px-4 z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="p-1.5 rounded-md hover:bg-muted/50 transition-colors flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Aktien-Analyse</span>
          </button>
          <div className="w-px h-5 bg-border" />
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-500" />
            <span className="text-sm font-semibold tracking-tight">Rezessions-Dashboard</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {data && showRecessionStand(data.asOf, new Date().toISOString().slice(0, 10)) && (
            <span className="hidden sm:inline text-xs text-muted-foreground" data-testid="text-recession-stand">
              Stand: {data.asOf}
            </span>
          )}
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-md hover:bg-muted/50 transition-colors"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      <main ref={mainRef} className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar">
        {!data && !analyzeMutation.isPending ? (
          <WelcomeScreen onStart={startAnalysis} />
        ) : analyzeMutation.isPending ? (
          <LoadingScreen />
        ) : analyzeMutation.isError ? (
          <ErrorScreen error={analyzeMutation.error} onRetry={startAnalysis} />
        ) : data ? (
          <div className="max-w-5xl mx-auto p-3 sm:p-4 space-y-3">
            <SectionCard number={1} title={`Aktuelle Bewertung zum ${data.date}`}>
              <RegionGaugeSwitch data={data} regions={regions} />
            </SectionCard>
            <SectionCard number={2} title="NY Fed / FRED Referenz">
              <NYFedReference data={data} />
            </SectionCard>
            <SectionCard number={3} title="Scoring-Regeln">
              <ScoringRules />
            </SectionCard>
            <SectionCard number={4} title="Scoring-Zonen">
              <ScoringZones />
            </SectionCard>
            <SectionCard number={5} title="Indikatoren-Tabelle">
              <IndicatorTable indicators={data.indicators} />
              <SahmRegions regions={data.sahmRegions} />
            </SectionCard>
            <SectionCard number={6} title="Score-Übersicht (5 Untergruppen)">
              <SubgroupOverview subgroups={data.subgroups} />
            </SectionCard>
            <SectionCard number={7} title="Prozentschätzungen">
              <ProbabilityEstimates subgroups={data.subgroups} />
            </SectionCard>
            {regions && (
              <SectionCard number={8} title="Regionale Kataloge (US / Eurozone / Japan)">
                <RegionalCatalogSection catalogs={regions} />
              </SectionCard>
            )}
            <RecessionRsiSection number={regions ? 9 : 8} />
            <RecessionMarketChartsSection number={regions ? 10 : 9} />
            <RecessionTaSection number={regions ? 11 : 10} subgroups={data.subgroups} topDrivers={data.topDrivers} indicators={data.indicators} />
            <SectionCard number={regions ? 12 : 11} title="Buffett-Indikator: Marktwert zum BIP">
              <BuffettRatioPanel />
            </SectionCard>
            <SectionCard number={regions ? 13 : 12} title="Zusammenfassung & Top-3 Treiber">
              <Summary data={data} />
            </SectionCard>
            {data.fazit && (
              <SectionCard number={regions ? 14 : 13} title="Fazit & Makro-Risikobewertung">
                <FazitSection fazit={data.fazit} />
              </SectionCard>
            )}
            <SectionCard number={regions ? (data.fazit ? 15 : 14) : (data.fazit ? 14 : 13)} title="Quellenliste">
              <SourcesList sources={data.sources} />
            </SectionCard>
            <div className="pb-4">
              <PerplexityAttribution />
            </div>
          </div>
        ) : null}
      </main>
      <ChatWidget
        dashboard="recession"
        context={chatContext}
        sections={chatSections}
        getActiveSectionId={getActiveSectionId}
        onJumpToSection={jumpToSection}
        suggestions={["Fasse die Rezessionslage in 5 Punkten zusammen", "Welche Indikatoren treiben das Risiko?", "Wie unterscheiden sich die 5 Untergruppen?"]}
      />
    </div>
  );
}
