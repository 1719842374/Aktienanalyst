import { AlertTriangle, RefreshCw } from "lucide-react";
import { describeApiError } from "@/lib/apiError";

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
  const palette = tone === "dark"
    ? "border-rose-800/60 bg-rose-950/40 text-rose-200"
    : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300";
  const muted = tone === "dark" ? "text-rose-300/70" : "text-rose-700/70 dark:text-rose-300/70";

  return (
    <div
      role="alert"
      data-testid={testId}
      data-error-kind={kind}
      className={`rounded-md border ${palette} ${block ? "px-4 py-6 text-center" : "px-4 py-2"} text-sm`}
    >
      <div className={`flex gap-2 ${block ? "flex-col items-center" : "items-start"}`}>
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-medium" data-testid={`${testId}-headline`}>
            {context ? `${context}: ` : ""}{headline}
          </p>
          {detail && (
            <details className={`mt-1 text-xs ${muted}`}>
              <summary className="cursor-pointer select-none">Details</summary>
              <p className="mt-1 break-all font-mono text-[11px]">{detail}</p>
            </details>
          )}
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-rose-400/40 px-2.5 py-1 text-xs font-medium hover:bg-rose-500/10 disabled:opacity-50"
            data-testid={`${testId}-retry`}
          >
            <RefreshCw className={`h-3 w-3 ${retrying ? "animate-spin" : ""}`} />
            Erneut versuchen
          </button>
        )}
      </div>
    </div>
  );
}
