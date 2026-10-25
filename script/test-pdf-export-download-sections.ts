/**
 * PDF-Export MSFT (Philip 25.10.2026 19:51 „PDF-Export funktioniert nicht“ / „keine Datei“).
 * Regressionstest offline (Fixture MSFT):
 *  - Client prüft die Antwort: JSON-Fehler (500/422/413), SPA-HTML (200 text/html) und leere Bodies gelten NICHT als PDF
 *    (main hat jede Antwort als MSFT_Analyse_….pdf gespeichert und kannte keinen Fallback trotz Kommentar).
 *  - Download: revokeObjectURL nicht synchron nach click() (Safari/Firefox brechen sonst ab).
 *  - Server: Sektionsbilder werden validiert und als Anhang eingebettet; ohne Bilder HTML bytegleich zu vorher.
 *  - Score/Rating: data.scoring unverändert, S6/Fazit-Zeilen und Urteil mit und ohne Bilder identisch.
 *  - Gerendertes PDF enthält die Bilder (pdfimages) und Sektion 3.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { generateAnalysisHTML, sanitizeSectionImages, sectionImagesHtml, renderHTMLtoPDF } from "../server/pdf-export";
import { checkPdfResponse, pdfFilename, MAX_SECTION_IMAGES } from "../client/src/lib/exportPdf";

let pass = 0, fail = 0;
const check = async (name: string, fn: () => void | Promise<void>) => { try { await fn(); pass++; console.log("  ✓", name); } catch (e: any) { fail++; console.log("  ✗", name, "—", String(e.message).split("\n")[0]); } };
const enc = (s: string) => new TextEncoder().encode(s);

function png(w: number, h: number, rgb: [number, number, number]): string {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  const buf = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return "data:image/png;base64," + buf.toString("base64");
}
const stripTime = (h: string) => h.replace(/\d{1,2}\.\d{1,2}\.\d{4}(, \d{1,2}:\d{2}:\d{2})?/g, "<t>");

const data = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
const scoringBefore = JSON.stringify(data.scoring);
const imgs = [3, 1, 2].map((id, i) => ({ id, label: `${id} · Sektion ${id}`, dataUrl: png(40 + i, 20, [30 * id, 120, 200]) }));

(async () => {
  console.log("PDF-Export Download + Sektionsbilder");
  await check("checkPdfResponse: echte PDF ok", () => assert.equal(checkPdfResponse(200, "application/pdf", enc("%PDF-1.4\n")), null));
  await check("checkPdfResponse: 500 JSON ist Fehler", () => assert.match(String(checkPdfResponse(500, "application/json", enc('{"error":"x"}'))), /HTTP 500/));
  await check("checkPdfResponse: 413 Payload zu groß ist Fehler", () => assert.match(String(checkPdfResponse(413, "text/html", enc("<html>"))), /HTTP 413/));
  await check("checkPdfResponse: SPA-HTML mit 200 ist Fehler", () => assert.match(String(checkPdfResponse(200, "text/html; charset=utf-8", enc("<!DOCTYPE html>"))), /kein PDF/));
  await check("checkPdfResponse: leerer Body ist Fehler", () => assert.match(String(checkPdfResponse(200, "application/pdf", new Uint8Array())), /leer/));
  await check("Dateiname wie Server (MSFT_Analyse_JJJJ-MM-TT.pdf)", () => assert.equal(pdfFilename("MSFT", new Date("2026-10-25T18:00:00Z")), "MSFT_Analyse_2026-10-25.pdf"));
  await check("Client: kein synchrones revokeObjectURL, echter jsPDF-Fallback, Fehler sichtbar (alert)", () => {
    const src = readFileSync("client/src/lib/exportPdf.ts", "utf8");
    const dl = src.slice(src.indexOf("export function triggerDownload"), src.indexOf("function sectionLabel"));
    assert.match(dl, /setTimeout\(\(\) => \{ a\.remove\(\); URL\.revokeObjectURL\(url\); \}/);
    assert.match(src, /import\("jspdf"\)/);
    assert.match(src, /import\("html2canvas"\)/);
    assert.ok((src.match(/alert\(/g) || []).length >= 3);
  });
  await check("Dashboard übergibt alle Sektions-Refs an den Export und zeigt Busy-Zustand", () => { const d = readFileSync("client/src/pages/Dashboard.tsx", "utf8"); assert.match(d, /exportAnalysisPdf\(data, Object\.entries\(sectionRefs\.current\)/); assert.match(d, /setPdfBusy\(true\)/); assert.match(d, /PDF wird erstellt/); });
  await check("Route trennt _sectionImages vom Analyse-Objekt", () => assert.match(readFileSync("server/pdf-export-route.ts", "utf8"), /const \{ _sectionImages, \.\.\.analysisData \}/));

  await check("sanitize: sortiert, verwirft javascript:/svg/html/zu große/ohne id, max 25", () => {
    const bad = [{ id: 9, dataUrl: "javascript:alert(1)" }, { id: 8, dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }, { id: 7, dataUrl: 'data:image/png;base64,AA"><script>' }, { dataUrl: imgs[0].dataUrl }, { id: 6, dataUrl: "data:image/png;base64," + "A".repeat(3_000_001) }];
    const out = sanitizeSectionImages([...imgs, ...bad]);
    assert.deepEqual(out.map(o => o.id), [1, 2, 3]);
    assert.equal(sanitizeSectionImages(Array.from({ length: 40 }, (_, i) => ({ id: i, dataUrl: imgs[0].dataUrl }))).length, MAX_SECTION_IMAGES);
    assert.deepEqual(sanitizeSectionImages("x"), []);
  });
  await check("Label wird escaped", () => assert.ok(!sectionImagesHtml(sanitizeSectionImages([{ id: 1, label: "<b>x</b>", dataUrl: imgs[0].dataUrl }])).includes("<b>x</b>")));

  const htmlNo = await generateAnalysisHTML(data);
  const htmlEmpty = await generateAnalysisHTML(data, []);
  const htmlImg = await generateAnalysisHTML(data, sanitizeSectionImages(imgs));
  await check("ohne Bilder: HTML bytegleich zum bisherigen Aufruf", () => assert.equal(stripTime(htmlEmpty), stripTime(htmlNo)));
  await check("mit Bildern: nur Anhang vor dem Footer kommt dazu", () => {
    const appendix = sectionImagesHtml(sanitizeSectionImages(imgs));
    assert.equal(stripTime(htmlImg.replace(appendix, "")), stripTime(htmlNo));
    assert.equal((htmlImg.match(/data-testid="pdf-section-img-/g) || []).length, 3);
  });
  await check("Sektion 3 im Template vorhanden", () => assert.match(htmlImg, /3 &nbsp; ZYKLUS- &amp; STRUKTURANALYSE|3 &nbsp; ZYKLUS- & STRUKTURANALYSE/));
  await check("S6/Fazit-Urteil mit und ohne Bilder identisch", () => {
    const pick = (h: string) => [...h.matchAll(/data-testid="pdf-(s6-[a-z]+|max-entry)"[^\n]*/g)].map(m => m[0]).join("|") + (h.match(/FAZIT: [A-ZÄÖÜ ]+/)?.[0] ?? "");
    assert.ok(pick(htmlNo).includes("FAZIT:"));
    assert.equal(pick(htmlImg), pick(htmlNo));
  });
  await check("data.scoring unverändert (bytegleich)", () => assert.equal(JSON.stringify(data.scoring), scoringBefore));

  await check("gerendertes PDF: gültig, enthält 3 Bilder und Sektion 3", async () => {
    const pdf = await renderHTMLtoPDF(htmlImg);
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    mkdirSync("/tmp/pdfdl-test", { recursive: true });
    writeFileSync("/tmp/pdfdl-test/msft-img.pdf", pdf);
    const list = execSync("pdfimages -list /tmp/pdfdl-test/msft-img.pdf").toString().trim().split("\n").slice(2);
    assert.ok(list.length >= 3, `pdfimages ${list.length}`);
    assert.match(execSync("pdftotext /tmp/pdfdl-test/msft-img.pdf -").toString(), /ZYKLUS- & STRUKTURANALYSE/);
  });

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
