import { useState } from "react";
import { Search, Loader2 } from "lucide-react";

interface TickerSearchProps {
  onSearch: (ticker: string) => void;
  isLoading: boolean;
}

export function TickerSearch({ onSearch, isLoading }: TickerSearchProps) {
  const [input, setInput] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onSearch(input.trim().toUpperCase());
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value.toUpperCase())}
          placeholder="Enter ticker..."
          className="h-8 w-32 sm:w-40 pl-8 pr-3 text-sm font-mono tabular-nums bg-muted/50 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary text-foreground placeholder:text-muted-foreground"
          data-testid="input-ticker"
          maxLength={10}
        />
      </div>
      <button
        type="submit"
        disabled={isLoading || !input.trim()}
        className="h-8 px-3 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
        data-testid="button-analyze"
      >
        {isLoading ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          "Analyze"
        )}
      </button>
    </form>
  );
}
