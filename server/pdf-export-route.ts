/**
 * POST /api/export-pdf — server-side PDF export (client/src/lib/exportPdf.ts).
 *
 * REGRESSION-FIX (11.10.2026): The handler lived inline in routes.ts (added in
 * c394f98, 16.04.2026) and was dropped when 57189dd (16.07.2026, BTC miner zone)
 * rewrote routes.ts from ~7600 to 279 lines. pdf-export.ts stayed, but nothing
 * called it, so Express' SPA catch-all answered with index.html (200 text/html)
 * and the browser saved the app page as "<TICKER>_Analyse_….pdf".
 * Same handler as before, now its own module like the other route files.
 */
import type { Express } from "express";
import { isEtfOrFund } from "../shared/conflict-matrix";

export function registerPdfExportRoute(app: Express): void {
  app.post("/api/export-pdf", async (req, res) => {
    try {
      // _sectionImages (Client-Aufnahme der Sektionen) vom Analyse-Objekt trennen: Fazit/Score sehen dieselben Daten wie vorher.
      const { _sectionImages, ...analysisData } = (req.body ?? {}) as any;
      if (!analysisData?.ticker) return res.status(400).json({ error: "No analysis data provided" });
      if (isEtfOrFund(analysisData)) {
        return res.status(422).json({ error: "ETF/Index – nicht im Aktien-Dashboard, kein PDF-Export", errorCode: "ETF_NOT_SUPPORTED", ticker: String(analysisData.ticker) });
      }
      const { generateAnalysisHTML, renderHTMLtoPDF, sanitizeSectionImages, sectionImagesChars, PDF_MAX_TOTAL_IMAGE_CHARS } = await import("./pdf-export");
      const imageChars = sectionImagesChars(_sectionImages);
      if (imageChars > PDF_MAX_TOTAL_IMAGE_CHARS) {
        return res.status(413).json({ error: `Sektionsbilder zu groß: ${(imageChars / 1e6).toFixed(1)} MB > ${(PDF_MAX_TOTAL_IMAGE_CHARS / 1e6).toFixed(1)} MB`, errorCode: "PDF_IMAGES_TOO_LARGE" });
      }
      console.log(`[PDF] Generating PDF for ${analysisData.ticker}...`);
      const images = sanitizeSectionImages(_sectionImages);
      const html = await generateAnalysisHTML(analysisData, images);
      const pdfBuffer = await renderHTMLtoPDF(html);
      console.log(`[PDF] Generated ${(pdfBuffer.length / 1024).toFixed(0)}KB PDF for ${analysisData.ticker} (${images.length} Sektionsbilder)`);
      const safeTicker = String(analysisData.ticker).replace(/[^A-Za-z0-9._-]/g, "_");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${safeTicker}_Analyse_${new Date().toISOString().slice(0, 10)}.pdf"`);
      res.send(pdfBuffer);
    } catch (err: any) {
      console.error(`[PDF] Error:`, err?.message?.substring(0, 200));
      res.status(500).json({ error: `PDF generation failed: ${err?.message?.substring(0, 100)}` });
    }
  });
  // express.json (10 MB, server/index.ts) lehnt zu große Bodies vor der Route ab → klare JSON-Meldung statt generischem 413.
  app.use("/api/export-pdf", (err: any, _req: any, res: any, next: any) => {
    if (err?.type !== "entity.too.large") return next(err);
    res.status(413).json({ error: `PDF-Anfrage zu groß: ${(Number(err.length) / 1e6).toFixed(1)} MB > ${(Number(err.limit) / 1e6).toFixed(1)} MB`, errorCode: "PDF_PAYLOAD_TOO_LARGE" });
  });
}
