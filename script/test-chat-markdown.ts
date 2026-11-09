/**
 * Assistant-Antworten im KI-Chat: sicheres Markdown (WORK_SIMPLYWALLST_LEARNINGS.md §4, Z. 64–72).
 * Soll: Überschriften, Listen, Fett, Tabellen, Code. Kein rohes HTML, keine javascript:-Links.
 * Nutzertext und Fehlerzeilen bleiben Rohtext. Darstellung nur, Antwort-Shape unverändert.
 * Ausführen: npx tsx --tsconfig script/tsconfig.jsx.json script/test-chat-markdown.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { ChatMarkdown } = await import("../client/src/components/chat/ChatMarkdown");

const html = (content: string) => renderToStaticMarkup(React.createElement(ChatMarkdown, { content }));

const answer = [
  "## Lage",
  "",
  "Die **Rezessionswahrscheinlichkeit** bleibt erhöht.",
  "",
  "- Sahm-Regel: aktiv",
  "- Zinskurve: invers",
  "",
  "| Indikator | Stand |",
  "| --- | --- |",
  "| P(Rezession) | 42 % |",
  "| Sahm | 0,5 |",
  "",
  "```",
  "Score = 0,7 * P + 0,3 * NYFed",
  "```",
  "",
  "Inline `P_score` bleibt Code.",
].join("\n");

const rendered = html(answer);
assert.match(rendered, /<h2[\s>]/, "Überschrift");
assert.match(rendered, /<strong[\s>][^<]*Rezessionswahrscheinlichkeit/, "Fett ohne Sternchen");
assert.doesNotMatch(rendered, /\*\*/, "keine rohen Markdown-Sternchen");
assert.match(rendered, /<ul[\s>]/, "Liste");
assert.match(rendered, /<li[\s>][^<]*Sahm-Regel/, "Listenpunkt");
assert.match(rendered, /<table[\s>]/, "Tabelle");
assert.match(rendered, /<th[\s>][^<]*Indikator/, "Tabellenkopf");
assert.match(rendered, /<td[\s>][^<]*42 %/, "Tabellenzelle");
assert.match(rendered, /<pre[\s>]/, "Codeblock");
assert.match(rendered, /Score = 0,7 \* P \+ 0,3 \* NYFed/, "Codeblock-Text");
assert.match(rendered, /<code[\s>][^<]*P_score/, "Inline-Code");
assert.match(rendered, /overflow-x-auto/, "Tabellen/Code laufen bei schmaler Breite nicht aus dem Fenster");
assert.match(rendered, /data-testid="chat-markdown"/);

const xss = html([
  '<script>alert(1)</script>',
  '<img src=x onerror="alert(1)">',
  '<a href="javascript:alert(1)">klick</a>',
  "[böse](javascript:alert(1))",
  "[daten](data:text/html,<script>alert(1)</script>)",
  "![pixel](https://evil.example/pixel.png)",
  "[Quelle](https://example.com/lage)",
].join("\n\n"));
assert.doesNotMatch(xss, /<\s*script\b/i, "kein script-Tag");
assert.doesNotMatch(xss, /<\s*img\b/i, "kein img-Tag");
assert.doesNotMatch(xss, /<\s*iframe\b/i, "kein iframe");
assert.doesNotMatch(xss, /javascript\s*:/i, "kein javascript:-URL");
assert.doesNotMatch(xss, /data\s*:\s*text\/html/i, "kein data-HTML");
assert.doesNotMatch(xss, /evil\.example/, "kein Remote-Bild");
assert.doesNotMatch(xss, /\son\w+\s*=/i, "kein Event-Handler-Attribut");
assert.match(xss, /href="https:\/\/example\.com\/lage"/, "https-Link bleibt");
assert.match(xss, /rel="noopener noreferrer nofollow"/, "Link ohne Opener");

const widget = readFileSync("client/src/components/chat/ChatWidget.tsx", "utf8");
const renderer = readFileSync("client/src/components/chat/ChatMarkdown.tsx", "utf8");
assert.match(widget, /m\.role === "assistant" && !m\.error \? <ChatMarkdown content=\{m\.content\} \/> : m\.content/);
assert.doesNotMatch(widget, /dangerouslySetInnerHTML/);
assert.doesNotMatch(renderer, /dangerouslySetInnerHTML/);
assert.doesNotMatch(renderer, /rehype-raw/);
assert.match(renderer, /remarkGfm|remark-gfm/);
assert.doesNotMatch(readFileSync("shared/chat-context.ts", "utf8") + readFileSync("server/chat-route.ts", "utf8"), /ChatMarkdown/);

console.log("chat markdown: OK");
