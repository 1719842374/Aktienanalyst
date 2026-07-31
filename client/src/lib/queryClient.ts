import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Compute API base URL based on environment.
// IMPORTANT: The string "__PORT_5000__" is a sentinel that publish_website
// rewrites to the correct proxy path during S3 upload. It must appear as a
// LITERAL string in the compiled JS bundle — do NOT construct it dynamically.
// When the sentinel is present (dev/non-published), it starts with "__" and we
// fall through to the runtime detection logic below.
const _SENTINEL = "__PORT_" + "5000__"; // split prevents accidental self-replacement

function computeApiBase(): string {
  // If the sentinel was rewritten by publish_website, use it directly
  const sentinel = "__PORT_5000__";
  if (!sentinel.startsWith("__")) return sentinel;

  // Dev / local environment
  const loc = typeof window !== 'undefined' ? window.location : null;
  if (!loc) return "";

  // Perplexity preview sandbox (sites.pplx.app)
  if (loc.hostname === 'sites.pplx.app') {
    const match = loc.pathname.match(/(\/sites\/proxy\/[^/]+)/);
    if (match) return match[1] + '/port/5000';
  }

  // Perplexity published app (*.pplx.app)
  // Use the sentinel path directly — the proxy handles /port/5000/* routing
  if (loc.hostname.endsWith('.pplx.app')) {
    return '/port/5000';
  }

  // Self-hosted (Railway, etc.) — same origin, no prefix
  return "";
}

const API_BASE = computeApiBase();

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

// apiRequest returns the raw Response so callers can inspect res.ok, res.status,
// and parse the JSON body themselves. This is critical for /api/analyze which
// returns structured error bodies (errorCode: RATE_LIMITED, fmpBudget, ...) on
// 429 / 503 that Dashboard.tsx needs to read. Do NOT re-add throwIfResNotOk
// here — that would collapse every non-2xx response into a plain Error string,
// hiding the structured payload the Dashboard's error UI depends on.
export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  timeoutMs = 90000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${url}`, {
      method,
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res;
  } catch (err: any) {
    clearTimeout(timer);
    if (err?.name === 'AbortError') throw new Error('Timeout: Server hat nicht innerhalb von 90s geantwortet');
    throw err;
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
// React-Query default fetcher. Handles two edge cases the SPA hosting layer
// creates on Render / pplx.app:
//   1. Missing backend route → the SPA index.html catch-all responds 200 with
//      Content-Type text/html. Blindly calling res.json() would throw a
//      SyntaxError with a huge stack that gets swallowed by React-Query and
//      leaves the page in a broken "error" state. We detect HTML and treat it
//      as "no data" (return null) instead.
//   2. 401 with returnNull behavior stays as before.
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`);

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    if (!res.ok) {
      const text = (await res.text()) || res.statusText;
      throw new Error(`${res.status}: ${text}`);
    }

    // Guard against SPA index.html leaking through for a non-existent API path.
    // Content-Type may be missing on some proxies — fall back to a body sniff.
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const body = await res.text();
      if (body.trim().startsWith("<")) {
        // HTML leaked through — endpoint doesn't exist. Treat as no data.
        return null as any;
      }
      try { return JSON.parse(body); } catch { return null as any; }
    }
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
