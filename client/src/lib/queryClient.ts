import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Compute API base: when deployed via sites.pplx.app proxy, derive the port proxy URL
function computeApiBase(): string {
  const placeholder = "__PORT_" + "5000__"; // split to avoid self-replacement by build tools
  if (!placeholder.startsWith("__")) return placeholder;
  
  const loc = typeof window !== 'undefined' ? window.location : null;
  if (loc && loc.hostname === 'sites.pplx.app') {
    // Port proxy URL structure: /sites/proxy/{JWT}/port/5000
    // Current page URL: /sites/proxy/{JWT}/{prefix}/.../index.html
    // We need: /sites/proxy/{JWT}/port/5000
    const match = loc.pathname.match(/(\/sites\/proxy\/[^/]+)/);
    if (match) {
      return match[1] + '/port/5000';
    }
  }
  
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
