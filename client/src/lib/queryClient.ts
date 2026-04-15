import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Compute API base: when deployed via sites.pplx.app proxy, derive the port proxy URL from current location
function computeApiBase(): string {
  const placeholder = "__PORT_" + "5000__"; // split to avoid self-replacement
  // If deploy_website replaced the placeholder, use it
  if (!placeholder.startsWith("__")) return placeholder;
  
  // Otherwise, detect deployed proxy environment and build the port proxy URL
  const loc = typeof window !== 'undefined' ? window.location : null;
  if (loc && loc.hostname === 'sites.pplx.app') {
    // Deployed on sites.pplx.app proxy — extract the base path and append /port/5000
    // URL format: /sites/proxy/{jwt}/{prefix}/index.html
    const pathParts = loc.pathname.split('/dist/public');
    if (pathParts.length > 1) {
      return pathParts[0] + '/dist/public/port/5000';
    }
    // Fallback: find the last /index.html and replace with /port/5000
    const base = loc.pathname.replace(/\/index\.html$/, '').replace(/\/[^/]*$/, '');
    return base + '/port/5000';
  }
  
  // Local dev: relative path
  return ".";
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
): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
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
