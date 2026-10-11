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
      const analysisData = req.body;
      if (!analysisData?.ticker) return res.status(400).json({ error: "No analysis data provided" });
      if (isEtfOrFund(analysisData)) {
        return res.status(422).json({ error: "ETF/Index – nicht im Aktien-Dashboard, kein PDF-Export", errorCode: "ETF_NOT_SUPPORTED", ticker: String(analysisData.ticker) });
      }
      console.log(`[PDF] Generating PDF for ${analysisData.ticker}...`);
      const { generateAnalysisHTML, renderHTMLtoPDF } = await import("./pdf-export");
      // Fazit-Hinweis Kreditmarkt (FRED BAA10Y, gecacht). Fehler → kein Hinweis, PDF läuft weiter.
      const { getMarketCreditSpread } = await import("./credit-route");
      const credit = await getMarketCreditSpread().catch(() => null);
      const html = await generateAnalysisHTML(analysisData, { creditStress: credit?.stress ?? null });
      const pdfBuffer = await renderHTMLtoPDF(html);
      console.log(`[PDF] Generated ${(pdfBuffer.length / 1024).toFixed(0)}KB PDF for ${analysisData.ticker}`);
      const safeTicker = String(analysisData.ticker).replace(/[^A-Za-z0-9._-]/g, "_");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${safeTicker}_Analyse_${new Date().toISOString().slice(0, 10)}.pdf"`);
      res.send(pdfBuffer);
    } catch (err: any) {
      console.error(`[PDF] Error:`, err?.message?.substring(0, 200));
      res.status(500).json({ error: `PDF generation failed: ${err?.message?.substring(0, 100)}` });
    }
  });
}
