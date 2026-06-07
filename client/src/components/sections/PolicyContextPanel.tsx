import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { apiRequest } from "../../lib/queryClient";
import type { StockAnalysis } from "../../../../shared/schema";

interface PolicyContext {
  usa: string;
  europa: string;
  asien: string;
  moatImpact: string;
}

interface Props {
  data: StockAnalysis;
  testIdSuffix: string;
}

// KI Analyse Trigger (analog Risiko-Erklärungen / Katalysatoren – via Claude 3.5 Haiku)
// Erklärt unternehmensspezifisch, wie aktuelle Regulierung, Fiskalprogramme
// und Geldpolitik in USA/Europa/Asien den Moat- bzw. PESTEL-Ausblick beeinflussen.
export function PolicyContextPanel({ data, testIdSuffix }: Props) {
  const [policy, setPolicy] = useState<PolicyContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function trigger() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest("POST", "/api/policy-context", {
        ticker: data.ticker,
        companyName: data.companyName,
        sector: data.sector,
        industry: data.industry,
        description: data.description,
        governmentExposure: data.governmentExposure,
      });
      const json = await res.json();
      if (json._llmSkipped || !json.policyContext) {
        setError("KI-Analyse nicht verfügbar (Token-Budget erschöpft).");
      } else {
        setPolicy(json.policyContext);
        setExpanded(true);
      }
    } catch (err: any) {
      const msg = err?.message || "";
      if (/503|402/.test(msg)) {
        setError("KI-Analyse nicht verfügbar (Token-Budget erschöpft).");
      } else {
        setError(msg || "KI-Analyse fehlgeschlagen.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border/50 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <button
          onClick={() => !loading && (policy ? setExpanded(e => !e) : trigger())}
          disabled={loading}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all ${
            policy
              ? "bg-violet-500/15 text-violet-400 border-violet-500/30"
              : "text-foreground/50 border-border/50 hover:bg-muted/50 hover:text-foreground/70"
          } ${loading ? "opacity-60 cursor-not-allowed" : ""}`}
          title="KI Analyse — Regulierung, Fiskalprogramme & Geldpolitik (USA/Europa/Asien) via Claude 3.5 Haiku"
          data-testid={`button-policy-ki-analyse-${testIdSuffix}`}
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          KI Analyse: Regulierung & Geldpolitik (USA/EU/Asien)
          {policy && !loading && <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />}
        </button>
        {loading && (
          <span className="text-[10px] text-muted-foreground animate-pulse">Generiere Politik-Analyse…</span>
        )}
      </div>

      {error && <div className="text-[11px] text-amber-500">{error}</div>}

      {policy && expanded && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1">
          <div className="rounded-md bg-muted/20 border border-border/40 p-2">
            <div className="text-[10px] font-bold text-foreground/70 uppercase tracking-wider mb-1">USA</div>
            <div className="text-[11px] text-muted-foreground leading-relaxed">{policy.usa}</div>
          </div>
          <div className="rounded-md bg-muted/20 border border-border/40 p-2">
            <div className="text-[10px] font-bold text-foreground/70 uppercase tracking-wider mb-1">Europa</div>
            <div className="text-[11px] text-muted-foreground leading-relaxed">{policy.europa}</div>
          </div>
          <div className="rounded-md bg-muted/20 border border-border/40 p-2">
            <div className="text-[10px] font-bold text-foreground/70 uppercase tracking-wider mb-1">Asien</div>
            <div className="text-[11px] text-muted-foreground leading-relaxed">{policy.asien}</div>
          </div>
          {policy.moatImpact && (
            <div className="sm:col-span-3 rounded-md bg-violet-500/5 border border-violet-500/20 p-2">
              <div className="text-[10px] font-bold text-violet-400 uppercase tracking-wider mb-1">Moat-Auswirkung</div>
              <div className="text-[11px] text-muted-foreground leading-relaxed">{policy.moatImpact}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
