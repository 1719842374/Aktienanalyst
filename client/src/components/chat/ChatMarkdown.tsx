/**
 * Assistant-Antworten als Markdown (WORK_SIMPLYWALLST_LEARNINGS.md §4, Z. 64–72).
 * react-markdown mit skipHtml: rohes HTML wird nicht zu DOM. Kein HTML-Plugin.
 * Links nur http(s) und mailto. Bilder werden nicht geladen (kein Remote-Pixel).
 * Tabellen und Codeblöcke scrollen horizontal, damit 375 px und 1440 px lesbar bleiben.
 */
import React from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function safeUrl(url: string): string {
  const value = url.trim();
  if (!value || value.startsWith("//")) return "";
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:") return value;
  } catch {
    /* relative oder ungültig: im Chat kein Ziel */
  }
  return "";
}

const remarkPlugins = [remarkGfm];

const components: Components = {
  h1: ({ children }) => <h2 className="mt-2 mb-1 text-sm font-semibold first:mt-0">{children}</h2>,
  h2: ({ children }) => <h2 className="mt-2 mb-1 text-sm font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-2 mb-1 text-[13px] font-semibold first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-1.5 mb-1 text-xs font-semibold first:mt-0">{children}</h4>,
  h5: ({ children }) => <h5 className="mt-1.5 mb-1 text-xs font-semibold first:mt-0">{children}</h5>,
  h6: ({ children }) => <h6 className="mt-1.5 mb-1 text-xs font-semibold first:mt-0">{children}</h6>,
  p: ({ children }) => <p className="my-1 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-1 list-disc space-y-0.5 pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 list-decimal space-y-0.5 pl-4">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-bold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => href
    ? <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2 break-all">{children}</a>
    : <span>{children}</span>,
  img: ({ alt }) => <span className="text-muted-foreground">{alt ? `[${alt}]` : "[Bild]"}</span>,
  blockquote: ({ children }) => <blockquote className="my-1 border-l-2 border-border pl-2 text-muted-foreground">{children}</blockquote>,
  hr: () => <hr className="my-2 border-border" />,
  table: ({ children }) => (
    <div className="my-1.5 max-w-full overflow-x-auto">
      <table className="w-max border-collapse text-left text-[11px] leading-snug">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-border px-1.5 py-1 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-border px-1.5 py-1 align-top">{children}</td>,
  pre: ({ children }) => (
    <pre className="my-1.5 max-w-full overflow-x-auto rounded-md bg-background/80 p-2 text-[11px] leading-snug">{children}</pre>
  ),
  code: ({ className, children }) => className
    ? <code className={`font-mono ${className}`}>{children}</code>
    : <code className="break-all rounded bg-background/80 px-1 py-0.5 font-mono text-[11px]">{children}</code>,
};

export function ChatMarkdown({ content }: { content: string }) {
  return (
    <div className="min-w-0 max-w-full break-words" data-testid="chat-markdown">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        skipHtml
        urlTransform={safeUrl}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
