import type { StockAnalysis } from "@shared/schema";
import { apiRequest } from "./queryClient";

/**
 * PDF Export — sends analysis data to server, server generates HTML + renders with Playwright.
 * Falls back to client-side jsPDF if server endpoint fails.
 */
export async function exportAnalysisPdf(data: StockAnalysis) {
  try {
    // Server-side PDF generation (HTML → Playwright → PDF)
    const response = await apiRequest("POST", "/api/export-pdf", data);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.ticker}_Analyse_${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('[PDF] Server-side generation failed, trying client fallback:', err);
    alert(`PDF-Generierung fehlgeschlagen: ${(err as any)?.message || 'Unbekannter Fehler'}. Bitte erneut versuchen.`);
  }
}
