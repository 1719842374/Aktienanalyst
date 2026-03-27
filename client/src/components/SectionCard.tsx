import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

interface SectionCardProps {
  number: number;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function SectionCard({ number, title, children, defaultOpen = true }: SectionCardProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div
      className="bg-card border border-card-border rounded-lg overflow-hidden"
      data-testid={`section-${number}`}
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
        data-testid={`section-${number}-toggle`}
      >
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-7 h-7 rounded-md bg-primary/10 text-primary text-xs font-bold tabular-nums">
            {number}
          </span>
          <h2 className="text-sm font-semibold text-foreground tracking-tight">{title}</h2>
        </div>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>
      {isOpen && <div className="px-4 pb-4 space-y-4">{children}</div>}
    </div>
  );
}
