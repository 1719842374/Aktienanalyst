import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiErrorFromResponse } from "@/lib/apiError";
import { ApiErrorBanner } from "@/components/ApiErrorBanner";
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

type RegionId = "US" | "EU" | "CN";

interface BuffettPoint {
  date: string;
  rawPct: number | null;
  geoPct: number | null;
  justifiedPct: number | null;
  foreignShare: number | null;
  multiple: number | null;
  qStar: number | null;
  gapPct: number | null;
  yieldPct: number | null;
  profitCagrPct: number | null;
  payout: number | null;
  gordonMultiple: number | null;
  gordonPct: number | null;
}

interface BuffettPayload {
  region: RegionId;
  asOf: string | null;
  note: string;
  latest: BuffettPoint | null;
  points: BuffettPoint[];
}

const REGIONS: { id: RegionId; name: string }[] = [
  { id: "US", name: "US" },
  { id: "EU", name: "Europa" },
  { id: "CN", name: "China" },
];

function pct(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "n/v";
  return `${value.toFixed(digits)}%`;
}

export function BuffettRatioPanel() {
  const [region, setRegion] = useState<RegionId>("US");
  const query = useQuery({
    queryKey: ["recession-buffett", region],
    queryFn: async () => {
      const res = await fetch(`/api/analyze-recession/buffett?region=${region}`);
      if (!res.ok) throw await apiErrorFromResponse(res);
      return await res.json() as BuffettPayload;
    },
  });
  const latest = query.data?.latest;
  const chart = (query.data?.points ?? []).filter(point => point.rawPct != null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {REGIONS.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => setRegion(item.id)}
            data-testid={`button-buffett-${item.id}`}
            className={`px-2.5 py-1 text-[11px] rounded-md border ${
              region === item.id
                ? "bg-orange-500/15 border-orange-500/40 text-orange-600 dark:text-orange-400"
                : "border-border text-muted-foreground hover:bg-muted/40"
            }`}
          >
            {item.name}
          </button>
        ))}
      </div>

      {query.isLoading && <p className="text-xs text-muted-foreground">Lade Marktquote…</p>}
      {query.error && (
        <ApiErrorBanner
          error={query.error}
          block={!query.data}
          onRetry={() => query.refetch()}
          retrying={query.isFetching}
          testId="text-buffett-error"
        />
      )}

      {query.data && (
        <>
          <p className="text-xs text-muted-foreground leading-relaxed">{query.data.note}</p>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm" data-testid="text-buffett-latest">
            <span className="font-mono text-lg">{pct(latest?.rawPct)}</span>
            <span className="text-xs text-muted-foreground">Rohquote {query.data.asOf ?? ""}</span>
            <span className="text-xs">nach Ausland {pct(latest?.geoPct)}</span>
            <span className="text-xs">gerechtfertigt {pct(latest?.justifiedPct)}</span>
            <span className="text-xs font-medium" data-testid="text-buffett-gap">
              Multiple-Abstand {pct(latest?.gapPct)}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-muted-foreground">
            <div>Auslandsgewinn {latest?.foreignShare == null ? "n/v" : pct(latest.foreignShare * 100, 1)}</div>
            <div>Multiple {latest?.multiple == null ? "n/v" : latest.multiple.toFixed(1)} · Median {latest?.qStar == null ? "n/v" : latest.qStar.toFixed(1)}</div>
            <div>Gewinnwachstum 10J {pct(latest?.profitCagrPct, 1)} · Rendite {pct(latest?.yieldPct, 1)}</div>
            <div>
              Zinsmodell {latest?.gordonMultiple == null
                ? (latest?.yieldPct != null && latest?.profitCagrPct != null && latest.yieldPct <= latest.profitCagrPct
                  ? "leer, Rendite liegt nicht über dem Gewinnwachstum"
                  : "n/v")
                : `${latest.gordonMultiple.toFixed(1)}${latest.gordonPct == null ? "" : ` · Quote ${pct(latest.gordonPct)}`}`}
            </div>
          </div>
          {chart.length > 0 ? (
            <div className="h-[280px] w-full" data-testid="chart-buffett">
              <ResponsiveContainer>
                <LineChart data={chart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={48} />
                  <YAxis tick={{ fontSize: 10 }} width={40} unit="%" />
                  <Tooltip
                    contentStyle={{ fontSize: 11 }}
                    formatter={(value: number, name: string) => [`${Number(value).toFixed(1)}%`, name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="rawPct" name="Rohquote" stroke="#3b82f6" dot={false} strokeWidth={1.6} connectNulls />
                  <Line type="monotone" dataKey="justifiedPct" name="Durch Gewinn gerechtfertigt" stroke="#f97316" dot={false} strokeWidth={1.4} connectNulls />
                  <Line type="monotone" dataKey="geoPct" name="Nach Auslandsgewinn" stroke="#14b8a6" dot={false} strokeWidth={1.4} strokeDasharray="5 4" connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Keine Marktquote für diese Region.</p>
          )}
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Der Multiple-Abstand ist Q geteilt durch den Median von Q bis Ende 2019, minus eins.
            Steigt der Gewinn im selben Maß wie die Marktkapitalisierung, bleibt dieser Abstand null.
            Die orangene Linie ist dieser Median mal dem Zehnjahresgewinn im Verhältnis zum BIP.
          </p>
        </>
      )}
    </div>
  );
}
