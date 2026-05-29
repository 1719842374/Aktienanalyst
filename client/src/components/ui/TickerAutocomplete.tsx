import { useState, useEffect, useRef, useCallback } from "react";
import { Search, Loader2 } from "lucide-react";

interface TickerResult {
  ticker: string;
  name: string;
  exchange: string;
  type: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSelect: (ticker: string) => void;
  placeholder?: string;
  className?: string;
}

export function TickerAutocomplete({ value, onChange, onSelect, placeholder = "Ticker oder Firmenname", className = "" }: Props) {
  const [results, setResults] = useState<TickerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (q.length < 1) { setResults([]); setOpen(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/search-ticker?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data.results || []);
      setOpen((data.results || []).length > 0);
      setActiveIdx(-1);
    } catch { setResults([]); }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value, search]);

  const handleSelect = (ticker: string) => {
    onChange(ticker);
    setOpen(false);
    setResults([]);
    onSelect(ticker);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, -1)); }
    if (e.key === "Enter" && activeIdx >= 0) { e.preventDefault(); handleSelect(results[activeIdx].ticker); }
    if (e.key === "Escape") { setOpen(false); }
  };

  return (
    <div className={`relative ${className}`}>
      <div className="relative flex items-center">
        <Search className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
        {loading && <Loader2 className="absolute right-3 h-3.5 w-3.5 text-muted-foreground animate-spin" />}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="w-full pl-9 pr-9 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/60"
        />
      </div>
      {open && results.length > 0 && (
        <div
          ref={listRef}
          className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-72 overflow-y-auto"
        >
          {results.map((r, i) => (
            <div
              key={r.ticker}
              onMouseDown={() => handleSelect(r.ticker)}
              className={`flex items-center gap-3 px-3 py-2 cursor-pointer text-sm transition-colors ${i === activeIdx ? "bg-accent" : "hover:bg-muted/60"}`}
            >
              <span className="font-mono font-semibold text-primary min-w-[60px] shrink-0">{r.ticker}</span>
              <span className="text-foreground/90 truncate flex-1">{r.name}</span>
              {r.exchange && <span className="text-[10px] text-muted-foreground shrink-0 bg-muted px-1.5 py-0.5 rounded">{r.exchange}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
