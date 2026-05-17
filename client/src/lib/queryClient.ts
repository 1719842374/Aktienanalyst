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
    await throwIfResNotOk(res);
    return res;
  } catch (err: any) {
    clearTimeout(timer);
    if (err?.name === 'AbortError') throw new Error('Timeout: Server hat nicht innerhalb von 90s geantwortet');
    throw err;
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`);

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
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
