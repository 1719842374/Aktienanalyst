export class ApiError extends Error {
  readonly status: number | null;
  readonly errorCode: string | null;

  constructor(message: string, status: number | null = null, errorCode: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errorCode = errorCode;
  }
}

export async function apiErrorFromResponse(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => ({} as Record<string, unknown>));
  const message = typeof body?.error === "string" && body.error ? body.error : `${res.status}: ${res.statusText}`;
  const errorCode = typeof body?.errorCode === "string" ? body.errorCode : null;
  return new ApiError(message, res.status, errorCode);
}

export type ApiErrorKind = "rate_limited" | "not_configured" | "upstream" | "network" | "unknown";

export interface ApiErrorCopy {
  kind: ApiErrorKind;
  headline: string;
  detail: string;
}

// Legacy servers only put the FMP status into the message ("FMP company-screener 429"),
// so the message is inspected as a fallback to status/errorCode.
export function describeApiError(err: unknown): ApiErrorCopy {
  const e = err as { status?: unknown; errorCode?: unknown; message?: unknown; name?: unknown } | null;
  const detail = String(e?.message ?? err ?? "").slice(0, 500);
  const status = typeof e?.status === "number" ? e.status : null;
  const code = typeof e?.errorCode === "string" ? e.errorCode : null;

  if (status === 429 || code === "RATE_LIMITED" || /\b429\b|rate.?limit|RATE_LIMITED/i.test(detail)) {
    return { kind: "rate_limited", headline: "Datenquelle ausgelastet — bitte später erneut versuchen.", detail };
  }
  if (code === "FMP_NOT_CONFIGURED" || /nicht konfiguriert|API_KEY not set/i.test(detail)) {
    return { kind: "not_configured", headline: "Datenquelle nicht konfiguriert — bitte Administrator informieren.", detail };
  }
  if (code === "FMP_UNREACHABLE" || e?.name === "TypeError" || /failed to fetch|networkerror|nicht erreichbar|timeout/i.test(detail)) {
    return { kind: "network", headline: "Datenquelle nicht erreichbar — Verbindung prüfen und erneut versuchen.", detail };
  }
  if ((status != null && status >= 500) || code === "FMP_UPSTREAM_ERROR" || /\b5\d\d\b/.test(detail)) {
    return { kind: "upstream", headline: "Datenquelle vorübergehend gestört — bitte erneut versuchen.", detail };
  }
  return { kind: "unknown", headline: "Daten konnten nicht geladen werden.", detail };
}
