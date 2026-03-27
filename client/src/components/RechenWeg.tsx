import { useState } from "react";
import { Calculator, ChevronDown, ChevronUp } from "lucide-react";

interface RechenWegProps {
  title?: string;
  steps: string[];
}

export function RechenWeg({ title = "Rechenweg", steps }: RechenWegProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mt-2 border border-border rounded-md overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
        data-testid={`rechenweg-${title.toLowerCase().replace(/\s/g, "-")}`}
      >
        <Calculator className="w-3 h-3" />
        <span className="font-medium">{title}</span>
        {isOpen ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
      </button>
      {isOpen && (
        <div className="px-3 pb-3 space-y-1 bg-muted/20">
          {steps.map((step, i) => (
            <div
              key={i}
              className="text-xs font-mono tabular-nums text-muted-foreground leading-relaxed"
            >
              {step}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
