import { CheckCircle2, XCircle } from "lucide-react";

/**
 * JA/NEIN-Karte der Technischen Analyse. Aus BTCDashboard Section 11
 * ausgelagert (Markup unveraendert), damit Gold dieselbe Karte nutzt.
 */
export function TaStatusPill({ label, value, detail }: { label: string; value: boolean; detail: string }) {
  return (
    <div className={`rounded-lg p-2 border text-center ${
      value ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"
    }`}>
      <div className="flex items-center justify-center gap-1 mb-0.5">
        {value ? (
          <CheckCircle2 className="w-3 h-3 text-green-500" />
        ) : (
          <XCircle className="w-3 h-3 text-red-500" />
        )}
        <span className={`text-[10px] font-semibold ${value ? "text-green-500" : "text-red-500"}`}>
          {value ? "JA" : "NEIN"}
        </span>
      </div>
      <div className="text-[9px] font-medium">{label}</div>
      {detail && <div className="text-[8px] text-muted-foreground mt-0.5 font-mono tabular-nums">{detail}</div>}
    </div>
  );
}
