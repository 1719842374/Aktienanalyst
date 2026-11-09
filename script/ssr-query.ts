import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/** SSR-Hülle wie die App: Queries bleiben pending, der Provider wirft nicht. */
export function withQuery(el: React.ReactElement): React.ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client }, el);
}

export function renderWithQuery(el: React.ReactElement): string {
  return renderToStaticMarkup(withQuery(el));
}
