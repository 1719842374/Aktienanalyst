import type { StockAnalysis } from "@shared/schema";
import { apiRequest } from "./queryClient";
import { fazitEntryForExport } from "@shared/fazit-entry";

/**
 * PDF-Export (#321-Folge, 25.10.2026).
 * 1) Jede gerenderte Dashboard-Sektion wird mit html2canvas als JPEG aufgenommen (bestehende Section-Komponenten, kein Nachbau).
 * 2) Server-PDF (/api/export-pdf: Text-Template inkl. S6/Fazit aus shared/fazit-entry) + Anhang „Sektionen als Bild“.
 * 3) Antwort wird geprüft (Status, Content-Type, %PDF-Signatur). Scheitert der Server, baut der Client das PDF selbst
 *    (jsPDF: Fazit-Werte + Sektionsbilder). Jeder Fehler wird sichtbar gemeldet, kein stiller Abbruch.
 */
export interface SectionShot { id: number; label: string; dataUrl: string; width: number; height: number }
export type PdfExportResult = { ok: true; via: "server" | "client"; filename: string; bytes: number; sections: number; serverError?: string } | { ok: false; error: string };

export const MAX_SECTION_IMAGES = 25;
const JPEG_QUALITY = 0.72;

export function pdfFilename(ticker: string, now = new Date()): string {
  return `${String(ticker).replace(/[^A-Za-z0-9._-]/g, "_")}_Analyse_${now.toISOString().slice(0, 10)}.pdf`;
}

/** true nur für eine echte PDF-Antwort (Status 2xx, application/pdf, %PDF-Signatur). Sonst Fehlertext. */
export function checkPdfResponse(status: number, contentType: string | null, head: Uint8Array): string | null {
  if (status < 200 || status >= 300) return `HTTP ${status}`;
  if (!String(contentType || "").toLowerCase().includes("application/pdf")) return `kein PDF (Content-Type ${contentType || "leer"})`;
  if (head.length < 5 || String.fromCharCode(...Array.from(head.slice(0, 5))) !== "%PDF-") return "leere oder beschädigte PDF-Antwort";
  return null;
}

/** Download über Blob-Link. revokeObjectURL erst verzögert: sofortiges Revoke bricht den Download in Safari/Firefox ab. */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 60_000);
}

function sectionLabel(el: HTMLElement, id: number): string {
  const h = el.querySelector("h2, h3");
  const t = (h?.textContent || "").replace(/\s+/g, " ").trim();
  return t ? `${id} · ${t}`.slice(0, 120) : `Sektion ${id}`;
}

/** Nimmt die gerenderten Sektionen (Dashboard-Refs, Reihenfolge nach id) als JPEG auf. Fehler je Sektion → übersprungen + gemeldet. */
export async function captureSections(els: Array<{ id: number; el: HTMLElement | null }>): Promise<{ shots: SectionShot[]; failed: number[] }> {
  const html2canvas = (await import("html2canvas")).default;
  const bg = getComputedStyle(document.body).backgroundColor || "#0c1223";
  const shots: SectionShot[] = [];
  const failed: number[] = [];
  for (const { id, el } of [...els].sort((a, b) => a.id - b.id)) {
    if (!el || el.offsetHeight === 0 || shots.length >= MAX_SECTION_IMAGES) continue;
    try {
      const canvas = await html2canvas(el, { backgroundColor: bg, scale: 1, logging: false, useCORS: true, windowWidth: Math.max(document.documentElement.clientWidth, 1024) });
      if (!canvas.width || !canvas.height) { failed.push(id); continue; }
      shots.push({ id, label: sectionLabel(el, id), dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY), width: canvas.width, height: canvas.height });
    } catch (err) {
      console.warn(`[PDF] Sektion ${id} nicht aufnehmbar:`, err);
      failed.push(id);
    }
  }
  return { shots, failed };
}

/** Client-Fallback: jsPDF mit Fazit-Werten (gleiche Quelle wie S6/S17) + Sektionsbildern. */
export async function buildClientPdf(data: StockAnalysis, shots: SectionShot[], reason: string): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, H = 297, M = 10;
  const fe = fazitEntryForExport(data as any);
  const n = (v: number | null | undefined, d = 2) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "n/a");
  doc.setFontSize(16); doc.text(`${data.ticker} – ${data.companyName ?? ""}`.slice(0, 80), M, 18);
  doc.setFontSize(9);
  doc.text(`Client-PDF (Server-Export fehlgeschlagen: ${reason})`.slice(0, 120), M, 25);
  doc.text(`Erstellt ${new Date().toLocaleString("de-DE")}`, M, 30);
  doc.setFontSize(11); doc.text("Fazit (S6/S17, shared/fazit-entry)", M, 40);
  doc.setFontSize(9);
  const rows: Array<[string, string]> = [
    ["Kurs", `${n(data.currentPrice)} ${data.currency ?? ""}`],
    ["Worst Case", fe ? `${n(fe.worstCase)} ${data.currency ?? ""}` : "n/a"],
    ["Fair Value (Entscheidungsbasis)", fe ? `${n(fe.fairValue)} ${fe.currency ?? ""}` : "n/a"],
    ["CRV Base", fe ? `${n(fe.crvBase, 1)}:1` : "n/a"],
    ["CRV Risikoadjustiert", fe ? `${n(fe.crvRiskAdj, 1)}:1` : "n/a"],
    ["Max-Entry (CRV 3:1)", fe ? fe.label : "n/a"],
    ["Score (data.scoring.finalScore)", n(data.scoring?.finalScore, 2)],
  ];
  rows.forEach(([k, v], i) => { doc.text(k, M, 47 + i * 6); doc.text(String(v), 120, 47 + i * 6); });
  for (const s of shots) {
    const w = W - 2 * M;
    const h = (s.height / s.width) * w;
    const pageH = H - 2 * M - 6;
    // Lange Sektionen über mehrere Seiten verteilen (gleiches Bild, versetzt).
    for (let off = 0; off < h; off += pageH) {
      doc.addPage();
      doc.setFontSize(8); doc.text(s.label + (off > 0 ? " (Forts.)" : ""), M, M + 3);
      doc.addImage(s.dataUrl, "JPEG", M, M + 6 - off, w, h);
    }
  }
  return doc.output("blob");
}

export async function exportAnalysisPdf(data: StockAnalysis, sectionEls: Array<{ id: number; el: HTMLElement | null }> = []): Promise<PdfExportResult> {
  const filename = pdfFilename(data.ticker);
  let shots: SectionShot[] = [];
  let failed: number[] = [];
  try {
    ({ shots, failed } = await captureSections(sectionEls));
  } catch (err) {
    console.warn("[PDF] Sektionsaufnahme fehlgeschlagen:", err);
  }
  let serverError: string | undefined;
  try {
    const res = await apiRequest("POST", "/api/export-pdf", { ...data, _sectionImages: shots }, 150_000);
    const buf = new Uint8Array(await res.arrayBuffer());
    const bad = checkPdfResponse(res.status, res.headers.get("content-type"), buf);
    if (bad) {
      let detail = "";
      try { detail = JSON.parse(new TextDecoder().decode(buf))?.error ?? ""; } catch { /* kein JSON */ }
      throw new Error(detail ? `${bad}: ${detail}` : bad);
    }
    triggerDownload(new Blob([buf], { type: "application/pdf" }), filename);
    if (failed.length) alert(`PDF erstellt. Nicht als Bild aufnehmbar: Sektion ${failed.join(", ")}.`);
    return { ok: true, via: "server", filename, bytes: buf.length, sections: shots.length };
  } catch (err: any) {
    serverError = String(err?.message || err || "Unbekannter Fehler");
    console.error("[PDF] Server-Export fehlgeschlagen, Client-Fallback:", serverError);
  }
  try {
    const blob = await buildClientPdf(data, shots, serverError);
    triggerDownload(blob, filename);
    alert(`Server-PDF fehlgeschlagen (${serverError}). Es wurde ein Client-PDF mit Fazit-Werten und ${shots.length} Sektionsbildern erstellt.`);
    return { ok: true, via: "client", filename, bytes: blob.size, sections: shots.length, serverError };
  } catch (err: any) {
    const msg = `PDF-Export fehlgeschlagen. Server: ${serverError}. Client-Fallback: ${err?.message || err}`;
    console.error("[PDF]", msg);
    alert(msg);
    return { ok: false, error: msg };
  }
}
