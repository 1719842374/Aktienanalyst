import { AlertTriangle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { describeApiError } from "@/lib/apiError";
import { cn } from "@/lib/utils";

interface ApiErrorBannerProps {
  error: unknown;
  /** Prefix for the headline, e.g. "KI-Anreicherung fehlgeschlagen". */
  context?: string;
  onRetry?: () => void;
  retrying?: boolean;
  /** Empty-state layout when there is no content to show below the banner. */
  block?: boolean;
  /** "dark" for pages with a fixed dark palette regardless of the app theme. */
  tone?: "theme" | "dark";
  testId?: string;
}

export function ApiErrorBanner({ error, context, onRetry, retrying, block, tone = "theme", testId = "api-error-banner" }: ApiErrorBannerProps) {
  const { kind, headline, detail } = describeApiError(error);
  const muted = tone === "dark" ? "text-rose-200/70" : "text-muted-foreground";

  return (
    <Alert
      variant="destructive"
      data-testid={testId}
      data-error-kind={kind}
      className={cn(
        tone === "dark" && "border-rose-800/60 bg-rose-950/40 text-rose-200",
        tone === "theme" && "bg-destructive/10",
        block && "py-6",
      )}
    >
      <AlertTriangle className="h-4 w-4" />
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <AlertTitle className="leading-snug" data-testid={`${testId}-headline`}>
            {context ? `${context}: ` : ""}{headline}
          </AlertTitle>
          {detail && (
            <AlertDescription>
              <details className={cn("mt-1 text-xs", muted)}>
                <summary className="cursor-pointer select-none">Details</summary>
                <p className="mt-1 break-all font-mono text-[11px]">{detail}</p>
              </details>
            </AlertDescription>
          )}
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-current px-2.5 py-1 text-xs font-medium opacity-90 hover:opacity-100 disabled:opacity-50"
            data-testid={`${testId}-retry`}
          >
            <RefreshCw className={cn("h-3 w-3", retrying && "animate-spin")} />
            Erneut versuchen
          </button>
        )}
      </div>
    </Alert>
  );
}
