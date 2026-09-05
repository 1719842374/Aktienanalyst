import { useState, useCallback, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { RECESSION_FALLBACK_DATA } from "@/lib/recessionFallbackData";
import { useTheme } from "@/components/ThemeProvider";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { SectionCard } from "@/components/SectionCard";
import { RecessionRsiSection } from "@/components/recession/RecessionRsiSection";
import { useLocation } from "wouter";
import { Sun, Moon, AlertTriangle, ArrowLeft } from "lucide-react";
import type { RecessionAnalysis } from "@/components/recession/recessionDashboardShared";
import {
  WelcomeScreen, LoadingScreen, ErrorScreen,
  CurrentAssessment, NYFedReference, ScoringRules, ScoringZones,
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
        const res = await apiRequest("POST", "/api/analyze-recession", {});
        const json = await res.json();
        if (!json || !json.indicators || !Array.isArray(json.indicators)) {
          throw new Error("Invalid response format");
        }
        return json as RecessionAnalysis;
      } catch {
        return RECESSION_FALLBACK_DATA as RecessionAnalysis;
      }
    },
    onSuccess: (result) => {
      setData(result);
    },
  });

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
          {data && (
            <span className="hidden sm:inline text-xs text-muted-foreground">
              Stand: {data.date}
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

      <main className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar">
        {!data && !analyzeMutation.isPending ? (
          <WelcomeScreen onStart={startAnalysis} />
        ) : analyzeMutation.isPending ? (
          <LoadingScreen />
        ) : analyzeMutation.isError ? (
          <ErrorScreen error={analyzeMutation.error} onRetry={startAnalysis} />
        ) : data ? (
          <div className="max-w-5xl mx-auto p-3 sm:p-4 space-y-3">
            <SectionCard number={1} title={`Aktuelle Bewertung zum ${data.date}`}>
              <CurrentAssessment data={data} />
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
            <SectionCard number={5} title="Indikatoren-Tabelle (17 Indikatoren)">
              <IndicatorTable indicators={data.indicators} />
            </SectionCard>
            <SectionCard number={6} title="Score-Übersicht (5 Untergruppen)">
              <SubgroupOverview subgroups={data.subgroups} />
            </SectionCard>
            <SectionCard number={7} title="Prozentschätzungen">
              <ProbabilityEstimates subgroups={data.subgroups} />
            </SectionCard>
            <RecessionRsiSection number={8} />
            <SectionCard number={9} title="Zusammenfassung & Top-3 Treiber">
              <Summary data={data} />
            </SectionCard>
            {data.fazit && (
              <SectionCard number={10} title="Fazit & Makro-Risikobewertung">
                <FazitSection fazit={data.fazit} />
              </SectionCard>
            )}
            <SectionCard number={data.fazit ? 11 : 10} title="Quellenliste">
              <SourcesList sources={data.sources} />
            </SectionCard>
            <div className="pb-4">
              <PerplexityAttribution />
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
