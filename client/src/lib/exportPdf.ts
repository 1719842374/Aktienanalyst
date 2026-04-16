import type { StockAnalysis } from "@shared/schema";
import { jsPDF } from "jspdf";

/**
 * Screenshot-based PDF export: captures each section from the DOM as an image
 * and pastes it into a PDF — 1:1 what you see in the frontend.
 */
export async function exportAnalysisPdf(data: StockAnalysis) {
  // Dynamic import html2canvas
  const html2canvas = (await import("html2canvas")).default;

  const doc = new jsPDF("portrait", "mm", "a4");
  const pageW = doc.internal.pageSize.getWidth();   // 210mm
  const pageH = doc.internal.pageSize.getHeight();   // 297mm
  const margin = 8;
  const contentW = pageW - 2 * margin;
  let currentY = margin;

  // Dark background for first page
  const drawBg = () => {
    doc.setFillColor(12, 18, 35);
    doc.rect(0, 0, pageW, pageH, "F");
  };
  drawBg();

  // Header
  doc.setFontSize(14); doc.setFont("helvetica", "bold"); doc.setTextColor(80, 160, 240);
  doc.text("Stock Analyst Pro", margin, currentY + 5);
  doc.setFontSize(7); doc.setTextColor(100, 110, 130); doc.setFont("helvetica", "normal");
  doc.text(`${data.ticker} — ${data.companyName} | ${data.sector} / ${data.industry}`, margin, currentY + 10);
  doc.text(`${new Date().toLocaleDateString("de-DE")} | Alle Werte in ${data.currency || "USD"}`, pageW - margin, currentY + 10, { align: "right" });
  currentY += 15;

  // Find all section containers in the DOM
  // They are wrapped in divs with ref={setSectionRef(N)} inside the main content area
  const mainContent = document.querySelector('.max-w-5xl');
  if (!mainContent) {
    console.error("[PDF] Could not find main content container");
    return;
  }

  // Get all direct children (each is a section wrapper)
  const sectionElements = mainContent.children;
  const totalSections = sectionElements.length;

  // Show progress indicator
  const progressEl = document.createElement('div');
  progressEl.id = 'pdf-progress';
  progressEl.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99999;background:rgba(12,18,35,0.95);border:1px solid rgba(80,160,240,0.3);border-radius:12px;padding:24px 40px;text-align:center;backdrop-filter:blur(10px);';
  progressEl.innerHTML = `
    <div style="color:#50a0f0;font-size:14px;font-weight:600;margin-bottom:8px;">PDF wird erstellt...</div>
    <div id="pdf-progress-text" style="color:#8899aa;font-size:12px;">Sektion 0 / ${totalSections}</div>
    <div style="margin-top:12px;width:200px;height:4px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden;">
      <div id="pdf-progress-bar" style="width:0%;height:100%;background:linear-gradient(90deg,#3b82f6,#60a5fa);border-radius:2px;transition:width 0.3s;"></div>
    </div>
  `;
  document.body.appendChild(progressEl);

  const updateProgress = (i: number, label: string) => {
    const pText = document.getElementById('pdf-progress-text');
    const pBar = document.getElementById('pdf-progress-bar');
    if (pText) pText.textContent = `${label} (${i + 1} / ${totalSections})`;
    if (pBar) pBar.style.width = `${((i + 1) / totalSections) * 100}%`;
  };

  try {
    for (let i = 0; i < totalSections; i++) {
      const section = sectionElements[i] as HTMLElement;
      if (!section || section.offsetHeight < 10) continue;

      // Get section name for progress
      const headerEl = section.querySelector('h2, h3, [class*="font-semibold"]');
      const sectionName = headerEl?.textContent?.substring(0, 40) || `Sektion ${i + 1}`;
      updateProgress(i, sectionName);

      // Capture section as canvas
      let canvas: HTMLCanvasElement;
      try {
        canvas = await html2canvas(section, {
          scale: 2,             // 2x for sharp text
          useCORS: true,
          backgroundColor: '#0c1223',
          logging: false,
          removeContainer: true,
          // Ignore elements that cause issues
          ignoreElements: (el) => {
            return el.tagName === 'IFRAME' || el.classList?.contains('pdf-ignore');
          },
        });
      } catch (err) {
        console.warn(`[PDF] Failed to capture section ${i + 1}: ${err}`);
        continue;
      }

      // Convert canvas to image data
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      const imgAspect = canvas.height / canvas.width;
      const imgW = contentW;
      const imgH = imgW * imgAspect;

      // If image is taller than a full page, split it
      if (imgH > pageH - 2 * margin) {
        // Large section: scale to fit width, may span multiple pages
        const maxPageImgH = pageH - margin - currentY;

        if (maxPageImgH < 20) {
          // Not enough room, new page
          doc.addPage(); drawBg(); currentY = margin;
        }

        // For very tall sections, we need to split the image across pages
        const totalImgH = imgH;
        let remainingH = totalImgH;
        let srcYOffset = 0;

        while (remainingH > 0) {
          const availH = pageH - margin - currentY;
          const sliceH = Math.min(remainingH, availH);
          const sliceFraction = sliceH / totalImgH;

          // Calculate source crop
          const srcY = srcYOffset / totalImgH * canvas.height;
          const srcH = sliceFraction * canvas.height;

          // Create a cropped canvas
          const sliceCanvas = document.createElement('canvas');
          sliceCanvas.width = canvas.width;
          sliceCanvas.height = Math.round(srcH);
          const ctx = sliceCanvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(canvas, 0, Math.round(srcY), canvas.width, Math.round(srcH), 0, 0, canvas.width, Math.round(srcH));
            const sliceImg = sliceCanvas.toDataURL('image/jpeg', 0.92);
            doc.addImage(sliceImg, 'JPEG', margin, currentY, imgW, sliceH);
          }

          currentY += sliceH + 2;
          srcYOffset += sliceH;
          remainingH -= sliceH;

          if (remainingH > 5) {
            doc.addPage(); drawBg(); currentY = margin;
          }
        }
      } else {
        // Normal section: check if it fits on current page
        if (currentY + imgH > pageH - margin) {
          doc.addPage(); drawBg(); currentY = margin;
        }

        doc.addImage(imgData, 'JPEG', margin, currentY, imgW, imgH);
        currentY += imgH + 2;
      }

      // Small delay to keep UI responsive
      await new Promise(r => setTimeout(r, 50));
    }

    // ====================== FAZIT (generated) ======================
    // Add verdict at the end
    const np = (needed: number) => {
      if (currentY + needed > pageH - margin) { doc.addPage(); drawBg(); currentY = margin; }
    };

    np(40);
    currentY += 3;
    doc.setDrawColor(40, 50, 70);
    doc.line(margin, currentY, pageW - margin, currentY);
    currentY += 5;

    // Build verdict
    let positives = 0, negatives = 0;
    const posList: string[] = [], negList: string[] = [];
    const fmt = (v: number | null | undefined, d = 1) => v != null && isFinite(v) ? v.toFixed(d) : "—";

    if (data.peRatio && data.sectorAvgPE && data.peRatio < data.sectorAvgPE) { positives++; posList.push(`P/E ${fmt(data.peRatio)} vs Sektor ${fmt(data.sectorAvgPE)} — Discount`); }
    else if (data.peRatio && data.sectorAvgPE && data.peRatio > data.sectorAvgPE * 1.2) { negatives++; negList.push(`P/E ${fmt(data.peRatio)} vs Sektor ${fmt(data.sectorAvgPE)} — Premium`); }
    if (data.pegRatio && data.pegRatio < 1) { positives++; posList.push(`PEG ${fmt(data.pegRatio,2)} < 1 — unterbewertet`); }
    else if (data.pegRatio && data.pegRatio > 2) { negatives++; negList.push(`PEG ${fmt(data.pegRatio,2)} > 2 — teuer`); }
    if (data.fcfMargin && data.fcfMargin > 15) { positives++; posList.push(`FCF Margin ${fmt(data.fcfMargin)}% — stark`); }
    if (data.rsl?.value && data.rsl.value > 110) { positives++; posList.push(`RSL ${fmt(data.rsl.value)} — starkes Momentum`); }
    else if (data.rsl?.value && data.rsl.value < 95) { negatives++; negList.push(`RSL ${fmt(data.rsl.value)} — schwaches Momentum`); }
    if (data.catalysts?.length) { const gb = data.catalysts.reduce((s,c) => s+c.gb, 0); if (gb > 10) { positives++; posList.push(`Katalysatoren-Upside +${fmt(gb,2)}%`); } }
    const allBuy = data.technicals?.priceAboveMA200 && data.technicals?.ma50AboveMA200 && data.technicals?.macdAboveZero && data.technicals?.macdRising;
    if (allBuy) { positives++; posList.push("Alle Kaufsignal-Bedingungen erfüllt"); }
    else { negatives++; negList.push("Kaufsignal nicht erfüllt"); }

    const verdict = positives > negatives + 1 ? "ATTRAKTIV" : positives > negatives ? "LEICHT ATTRAKTIV" : positives === negatives ? "NEUTRAL" : "UNATTRAKTIV";
    const vColor = verdict.includes("ATTRAKTIV") ? [80,200,80] : verdict === "NEUTRAL" ? [150,160,180] : [200,80,80];

    // Verdict box
    doc.setFillColor(vColor[0]/10, vColor[1]/10, vColor[2]/10 + 10);
    doc.setDrawColor(vColor[0], vColor[1], vColor[2]);
    doc.roundedRect(margin, currentY, pageW - 2 * margin, 20, 2, 2, "FD");
    doc.setFontSize(14); doc.setFont("helvetica", "bold");
    doc.setTextColor(vColor[0], vColor[1], vColor[2]);
    doc.text(`FAZIT: ${verdict}`, pageW / 2, currentY + 8, { align: "center" });
    doc.setFontSize(7); doc.setFont("helvetica", "normal"); doc.setTextColor(170,175,185);
    doc.text(`${data.companyName} (${data.ticker}) — ${positives} positive, ${negatives} negative Faktoren`, pageW / 2, currentY + 15, { align: "center" });
    currentY += 24;

    // Positive factors
    if (posList.length) {
      doc.setFontSize(7); doc.setFont("helvetica", "bold"); doc.setTextColor(130,145,170);
      doc.text("Positive Faktoren", margin, currentY + 3); currentY += 5;
      for (const p of posList) {
        np(4);
        doc.setFontSize(6.5); doc.setTextColor(80,200,80); doc.setFont("helvetica","normal");
        doc.text(`+ ${p}`, margin + 2, currentY + 2.5);
        currentY += 3.5;
      }
    }
    if (negList.length) {
      currentY += 2;
      doc.setFontSize(7); doc.setFont("helvetica", "bold"); doc.setTextColor(130,145,170);
      doc.text("Negative Faktoren", margin, currentY + 3); currentY += 5;
      for (const n of negList) {
        np(4);
        doc.setFontSize(6.5); doc.setTextColor(200,80,80); doc.setFont("helvetica","normal");
        doc.text(`− ${n}`, margin + 2, currentY + 2.5);
        currentY += 3.5;
      }
    }

    // Footer
    np(12);
    currentY += 3;
    doc.setDrawColor(40, 50, 70);
    doc.line(margin, currentY, pageW - margin, currentY);
    currentY += 3;
    doc.setFontSize(5.5); doc.setFont("helvetica","italic"); doc.setTextColor(90,100,120);
    doc.text("Stock Analyst Pro — Erstellt mit Perplexity Computer", margin, currentY + 2);
    doc.text("Quellen: Perplexity Finance API, Damodaran (NYU Stern), SEC EDGAR, Google News (EN/DE)", margin, currentY + 5);
    doc.text(`Generiert: ${new Date().toLocaleString("de-DE")} | ${doc.getNumberOfPages()} Seiten`, pageW - margin, currentY + 2, { align: "right" });

    // Save
    const filename = `${data.ticker}_Analyse_${new Date().toISOString().slice(0,10)}.pdf`;
    try { doc.save(filename); } catch {
      const blob = doc.output('blob');
      window.open(URL.createObjectURL(blob), '_blank');
    }
  } finally {
    // Remove progress indicator
    progressEl.remove();
  }
}
