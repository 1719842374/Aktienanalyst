# Phase-2: Researcher Buttons — Apply in GitHub Web Editor

Researcher.tsx is restored. Apply these **4 search-replace** blocks in:
https://github.com/1719842374/Aktienanalyst/edit/main/client/src/pages/Researcher.tsx

Do them in order. Commit once at the end.

---

## 1) Imports (top of file)

**Find:**
```
import {
  ArrowLeft, Globe2, TrendingUp, Search, Landmark, RefreshCw,
  Loader2, ShieldCheck, AlertTriangle, Sparkles, ChevronRight,
  Zap, ArrowUp, ArrowDown, Minus, Flame, Activity
} from "lucide-react";
```

**Replace with:**
```
import {
  ArrowLeft, Globe2, TrendingUp, Search, Landmark, RefreshCw,
  Loader2, ShieldCheck, AlertTriangle, Sparkles, ChevronRight,
  Zap, ArrowUp, ArrowDown, Minus, Flame, Activity, ListPlus
} from "lucide-react";
import { TickerAddButtons, bulkAddToWatchlist } from "@/components/portfolio/TickerAddButtons";
```

---

## 2) ScreenerPanel — bulk + per-row buttons

**Find:**
```
  return (
    <div className="space-y-2">
      {candidates.map((c, idx) => (
        <div key={c.ticker || idx} className="rounded-lg border border-border/40 bg-card/30 p-3">
          <div className="flex items-start gap-3">
            <div className="shrink-0">
              <div className="text-[10px] font-mono text-foreground/40">#{idx + 1}</div>
              <div className="text-base font-bold font-mono text-foreground/95">{c.ticker}</div>
```

**Replace with:**
```
  function handleBulkWatchlist() {
    const items = candidates
      .filter((c: any) => c?.ticker)
      .map((c: any) => ({ ticker: String(c.ticker), name: c.companyName, score: c.moatScore ?? null }));
    const r = bulkAddToWatchlist(items, "researcher");
    window.alert(`Watchlist: ${r.added} neu, ${r.skipped} übersprungen (Duplikat/leer)`);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[10px] text-foreground/50">{candidates.length} Kandidaten</span>
        <button
          type="button"
          onClick={handleBulkWatchlist}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] border border-border/50 text-foreground/80 hover:bg-muted/40"
          title="Alle sichtbaren Screener-Kandidaten zur Watchlist (P2/P3)"
        >
          <ListPlus className="w-3 h-3" /> Alle sichtbaren zur Watchlist
        </button>
      </div>
      {candidates.map((c, idx) => (
        <div key={c.ticker || idx} className="rounded-lg border border-border/40 bg-card/30 p-3">
          <div className="flex items-start gap-3">
            <div className="shrink-0">
              <div className="text-[10px] font-mono text-foreground/40">#{idx + 1}</div>
              <div className="text-base font-bold font-mono text-foreground/95">{c.ticker}</div>
```

**Then find** (still in ScreenerPanel metrics column):
```
            <div className="shrink-0 grid grid-cols-2 gap-x-3 gap-y-1 text-right text-[10px]">
              <div className="text-foreground/40">MCap</div>
```

**Replace with:**
```
            <div className="shrink-0 flex flex-col items-end gap-2">
              <TickerAddButtons ticker={c.ticker} name={c.companyName} source="researcher" score={c.moatScore ?? null} />
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-right text-[10px]">
              <div className="text-foreground/40">MCap</div>
```

**Then find** (closing of metrics):
```
              <div className="font-bold tabular-nums text-amber-400">{c.marginRiskScore}/10</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Tab 4: Capex & Fiscal
```

**Replace with:**
```
              <div className="font-bold tabular-nums text-amber-400">{c.marginRiskScore}/10</div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Tab 4: Capex & Fiscal
```

---

## 3) Briefing ticker chips

**Find:**
```
          {tickers.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {tickers.slice(0, 8).map((t: string, i: number) => (
                <span key={i} className="px-1.5 py-0.5 rounded bg-violet-500/10 text-[10px] font-mono text-violet-300/90 border border-violet-400/20">{t}</span>
              ))}
            </div>
          )}
```

**Replace with:**
```
          {tickers.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1 items-center">
              {tickers.slice(0, 8).map((t: string, i: number) => (
                <span key={i} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-violet-500/10 text-[10px] font-mono text-violet-300/90 border border-violet-400/20">
                  {t}
                  <TickerAddButtons ticker={t} source="researcher" compact />
                </span>
              ))}
              <button
                type="button"
                className="text-[9px] px-1.5 py-0.5 rounded border border-border/40 text-foreground/60 hover:bg-muted/40"
                onClick={() => {
                  const r = bulkAddToWatchlist(tickers.slice(0, 12).map((t: string) => ({ ticker: t })), "researcher");
                  window.alert(`Watchlist: ${r.added} neu, ${r.skipped} übersprungen`);
                }}
              >
                Alle → Watchlist
              </button>
            </div>
          )}
```

---

## 4) Capex beneficiaries (2 places)

**Find:**
```
                        {s.listedBeneficiaries.map((b: any) => (
                          <div key={b.ticker} className="flex items-start gap-2 text-[10px]">
                            <span className="font-mono font-bold text-primary shrink-0 w-14">{b.ticker}</span>
                            <span className="text-muted-foreground">
                              {b.name && <span className="text-foreground/80 font-medium">{b.name}</span>}
                              {b.name && b.rationale && <span className="text-foreground/40"> · </span>}
                              {b.rationale}
                            </span>
                          </div>
                        ))}
```

**Replace with:**
```
                        {s.listedBeneficiaries.map((b: any) => (
                          <div key={b.ticker} className="flex items-start gap-2 text-[10px]">
                            <span className="font-mono font-bold text-primary shrink-0 w-14">{b.ticker}</span>
                            <span className="text-muted-foreground flex-1 min-w-0">
                              {b.name && <span className="text-foreground/80 font-medium">{b.name}</span>}
                              {b.name && b.rationale && <span className="text-foreground/40"> · </span>}
                              {b.rationale}
                            </span>
                            <TickerAddButtons ticker={b.ticker} name={b.name} source="researcher" compact />
                          </div>
                        ))}
```

**Find:**
```
                  {p.listedBeneficiaries.map((b: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-[10px]">
                      <span className="font-mono font-bold text-primary shrink-0 min-w-[56px]">{b.ticker}</span>
                      <span className="text-muted-foreground">
                        {b.name && <span className="text-foreground/80 font-medium">{b.name}</span>}
                        {b.name && b.rationale && <span className="text-foreground/40"> · </span>}
                        {b.rationale}
                      </span>
                    </div>
                  ))}
```

**Replace with:**
```
                  {p.listedBeneficiaries.map((b: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-[10px]">
                      <span className="font-mono font-bold text-primary shrink-0 min-w-[56px]">{b.ticker}</span>
                      <span className="text-muted-foreground flex-1 min-w-0">
                        {b.name && <span className="text-foreground/80 font-medium">{b.name}</span>}
                        {b.name && b.rationale && <span className="text-foreground/40"> · </span>}
                        {b.rationale}
                      </span>
                      <TickerAddButtons ticker={b.ticker} name={b.name} source="researcher" compact />
                    </div>
                  ))}
```

---

Commit message: `Phase-2: Researcher Screener/Capex/Briefing Watchlist+Portfolio buttons`

`TickerAddButtons` + `watchlist` + `portfolioBridge` are already on main.
