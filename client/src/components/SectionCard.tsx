import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

interface SectionCardProps {
  number: number | string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  actions?: React.ReactNode;
}

export function SectionCard({ number, title, subtitle, children, defaultOpen = true, actions }: SectionCardProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const badge = String(number);

  return (
    <div
      className="bg-card border border-card-border rounded-lg overflow-hidden"
      data-testid={`section-${badge}`}
    >
      <div className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-muted/50 transition-colors">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex-1 flex items-center gap-3 text-left min-w-0"
          data-testid={`section-${badge}-toggle`}
        >
          <span className="flex items-center justify-center w-7 min-w-[1.75rem] h-7 px-1.5 rounded-md bg-primary/10 text-primary text-xs font-bold tabular-nums">
            {badge}
          </span>
          <div className="text-left min-w-0">
            <h2 className="text-sm font-semibold text-foreground tracking-tight">{title}</h2>
            {subtitle ? (
              <div className="text-[10px] text-muted-foreground tracking-wide mt-0.5">{subtitle}</div>
            ) : null}
          </div>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {actions}
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground"
            aria-label={isOpen ? "Sektion einklappen" : "Sektion ausklappen"}
          >
            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {isOpen && <div className="px-4 pb-4 space-y-4">{children}</div>}
    </div>
  );
}
