import { useState, useEffect, useRef } from "react";
import { Search, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface TickerSearchProps {
  onSearch: (ticker: string) => void;
  isLoading: boolean;
}

interface SearchResult {
  ticker: string;
  name: string;
  exchange?: string;
  type?: string;
}

export function TickerSearch({ onSearch, isLoading }: TickerSearchProps) {
  const [input, setInput] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const debounceRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Debounced search — 250ms after last keystroke
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const q = input.trim();
    if (q.length < 1) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      try {
        setSearching(true);
        const res = await apiRequest("GET", `/api/search-ticker?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setResults(Array.isArray(data?.results) ? data.results : []);
        setOpen(true);
        setHighlight(-1);
      } catch (e) {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [input]);

  // Click-outside zum Schließen
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function chooseResult(r: SearchResult) {
    setInput(r.ticker);
    setOpen(false);
    setResults([]);
    onSearch(r.ticker);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim().toUpperCase();
    if (!q) return;
    // Wenn ein Result hervorgehoben ist, nimm das. Sonst nimm den Roh-Input
    // (User kann auch direkt vollständigen Ticker wie BAJAJ-AUTO.NS eingeben)
    if (open && highlight >= 0 && results[highlight]) {
      chooseResult(results[highlight]);
    } else {
      setOpen(false);
      onSearch(q);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, -1));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 shrink-0">
      <div ref={wrapperRef} className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          onKeyDown={handleKeyDown}
          placeholder="Ticker oder Firmenname…"
          className="h-8 w-40 sm:w-56 pl-8 pr-7 text-sm font-mono tabular-nums bg-muted/50 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary text-foreground placeholder:text-muted-foreground"
          data-testid="input-ticker"
          maxLength={32}
          autoComplete="off"
          spellCheck={false}
        />
        {searching && (
          <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 animate-spin text-muted-foreground" />
        )}

        {/* Autocomplete-Dropdown */}
        {open && results.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 max-h-80 overflow-y-auto bg-card border border-border rounded-md shadow-lg z-50 min-w-[280px] sm:min-w-[360px]">
            {results.map((r, i) => (
              <button
                key={r.ticker}
                type="button"
                onClick={() => chooseResult(r)}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full text-left px-3 py-2 text-xs border-b border-border/50 last:border-b-0 transition-colors ${
                  i === highlight ? "bg-primary/10" : "hover:bg-muted/40"
                }`}
                data-testid={`option-ticker-${r.ticker}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono font-semibold text-foreground truncate">{r.ticker}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {r.exchange || ""}
                  </span>
                </div>
                <div className="text-foreground/70 truncate mt-0.5">{r.name}</div>
              </button>
            ))}
          </div>
        )}

        {/* Empty-State falls Search abgeschlossen aber keine Treffer */}
        {open && !searching && results.length === 0 && input.trim().length >= 1 && (
          <div className="absolute top-full left-0 right-0 mt-1 px-3 py-2 text-[11px] text-muted-foreground bg-card border border-border rounded-md shadow-lg z-50 min-w-[280px]">
            Keine Treffer. Du kannst trotzdem mit Enter den exakten Ticker analysieren (z.B. <span className="font-mono">BAJAJ-AUTO.NS</span>).
          </div>
        )}
      </div>
      <button
        type="submit"
        disabled={isLoading || !input.trim()}
        className="h-8 px-3 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 shrink-0"
        data-testid="button-analyze"
      >
        {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Analyze"}
      </button>
    </form>
  );
}
