/**
 * PDF-Auslieferung auf iOS/iPadOS (Safari und alle iOS-Browser = WebKit).
 * Problem: Der Export dauert 54–75 s. Danach ist die transiente User-Activation des Klicks abgelaufen, und iOS-Safari
 * ignoriert `a.download` auf eine blob-URL oder navigiert zu ihr (FileSaver.js #282, webkit.org/blog/13862).
 * Lösung: Auf iOS wird nach dem Export nicht automatisch geladen. Ein Knopf „PDF öffnen/teilen“ holt eine frische Geste,
 * und im selben synchronen Handler wird navigator.share({ files }) aufgerufen (vor dem Aufruf kein await). Ohne
 * Datei-Share gibt es den Anchor-Download mit frischer Geste. Desktop und Android behalten den bisherigen Auto-Download.
 */
type NavLike = {
  userAgent?: string; platform?: string; maxTouchPoints?: number;
  canShare?: (d: { files: File[] }) => boolean;
  share?: (d: { files: File[]; title?: string }) => Promise<void>;
};

/** iPhone/iPod/iPad, auch iPadOS im Desktop-Modus (meldet sich als MacIntel mit Touch). */
export function isIOSWebKit(nav: NavLike | undefined): boolean {
  if (!nav) return false;
  const ua = String(nav.userAgent || "");
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return nav.platform === "MacIntel" && Number(nav.maxTouchPoints || 0) > 1;
}

/**
 * true → PDF nicht automatisch laden, sondern über den Knopf „PDF öffnen/teilen“ mit frischer Geste ausliefern.
 * Bewusst nur nach Plattform, nicht nach navigator.userActivation: Die API fehlt vor Safari 16.4, und unter Automation
 * meldet Chromium isActive=true auch ohne Klick. Der Export dauert immer weit länger als WebKits Activation-Fenster.
 */
export function needsGestureHandoff(nav: NavLike | undefined): boolean {
  return isIOSWebKit(nav);
}

export type GestureDelivery = "share" | "download";

/**
 * MUSS synchron im Klick-Handler laufen (keine awaits davor), sonst ist die Activation wieder weg.
 * Teilen mit Datei, wenn möglich; sonst Download. Abbruch durch den Nutzer (AbortError) ist kein Fehler.
 */
export function deliverPdfOnGesture(blob: Blob, filename: string, nav: NavLike, download: (b: Blob, f: string) => void): GestureDelivery {
  let file: File | null = null;
  try { file = new File([blob], filename, { type: "application/pdf" }); } catch { file = null; }
  if (file && typeof nav.share === "function" && typeof nav.canShare === "function" && nav.canShare({ files: [file] })) {
    nav.share({ files: [file], title: filename }).catch((err: any) => {
      if (err?.name === "AbortError") return;
      console.warn("[PDF] Teilen fehlgeschlagen, Download:", err?.name || err);
      download(blob, filename);
    });
    return "share";
  }
  download(blob, filename);
  return "download";
}
