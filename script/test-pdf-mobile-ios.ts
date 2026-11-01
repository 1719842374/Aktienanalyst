// PDF-Export mobil/iOS: Status-Hinweis < 640 px, iOS-Übergabe an frische Geste, Desktop unverändert.
import { readFileSync } from "node:fs";
import { deliverPdfOnGesture, isIOSWebKit, needsGestureHandoff } from "../client/src/lib/pdfDelivery";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fail++; };

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";
const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36";

ok(isIOSWebKit({ userAgent: IPHONE }), "iPhone erkannt");
ok(isIOSWebKit({ userAgent: MAC, platform: "MacIntel", maxTouchPoints: 5 }), "iPadOS Desktop-Modus erkannt");
ok(!isIOSWebKit({ userAgent: MAC, platform: "MacIntel", maxTouchPoints: 0 }), "Mac-Safari Desktop = kein iOS");
ok(!isIOSWebKit({ userAgent: WIN, platform: "Win32" }), "Windows Chrome = kein iOS");
ok(!isIOSWebKit({ userAgent: ANDROID, platform: "Linux armv8l", maxTouchPoints: 5 }), "Android = kein iOS");
// Nach 54–75 s Export ist die Activation überall abgelaufen (Report Befund 2). Nur iOS bekommt die Übergabe.
ok(needsGestureHandoff({ userAgent: IPHONE }), "iOS → Knopf (frische Geste)");
ok(!needsGestureHandoff({ userAgent: WIN, platform: "Win32" }), "Desktop → Auto-Download wie bisher");
ok(!needsGestureHandoff({ userAgent: ANDROID, platform: "Linux armv8l", maxTouchPoints: 5 }), "Android → Auto-Download wie bisher");

const blob = new Blob([new Uint8Array([37, 80, 68, 70])], { type: "application/pdf" });
{ // Share mit Datei, synchron aufgerufen
  const calls: string[] = []; let shared: any = null;
  const r = deliverPdfOnGesture(blob, "X.pdf", { canShare: () => true, share: (d) => { shared = d; calls.push("share"); return Promise.resolve(); } }, () => calls.push("download"));
  ok(r === "share" && calls.join() === "share", "canShare(files) → navigator.share synchron, kein Download");
  ok(shared?.files?.[0]?.name === "X.pdf" && shared.files[0].type === "application/pdf", "geteilte Datei: Name + application/pdf");
}
{ // kein Datei-Share → Download mit frischer Geste
  const calls: string[] = [];
  const r = deliverPdfOnGesture(blob, "X.pdf", { canShare: () => false, share: () => Promise.resolve() }, () => calls.push("download"));
  ok(r === "download" && calls.join() === "download", "canShare false → Download");
  const r2 = deliverPdfOnGesture(blob, "X.pdf", {}, () => calls.push("download"));
  ok(r2 === "download", "ohne Web Share API → Download");
}
{ // Abbruch durch Nutzer = kein Fallback; anderer Fehler = Download
  const calls: string[] = [];
  deliverPdfOnGesture(blob, "X.pdf", { canShare: () => true, share: () => Promise.reject(Object.assign(new Error("x"), { name: "AbortError" })) }, () => calls.push("abort-dl"));
  deliverPdfOnGesture(blob, "X.pdf", { canShare: () => true, share: () => Promise.reject(Object.assign(new Error("x"), { name: "NotAllowedError" })) }, () => calls.push("err-dl"));
  await new Promise((r) => setTimeout(r, 10));
  ok(!calls.includes("abort-dl") && calls.includes("err-dl"), "AbortError ohne Download, NotAllowedError → Download");
}

const dash = readFileSync(new URL("../client/src/pages/Dashboard.tsx", import.meta.url), "utf8");
const exp = readFileSync(new URL("../client/src/lib/exportPdf.ts", import.meta.url), "utf8");
ok(/data-testid="pdf-export-status-mobile"/.test(dash) && /sm:hidden[^"]*fixed/.test(dash), "Mobiler Status-Hinweis (sm:hidden) vorhanden");
ok(/disabled=\{pdfBusy\}/.test(dash), "Button während Export disabled");
ok(/data-testid="button-pdf-open-share"/.test(dash), "Knopf „PDF öffnen/teilen“ vorhanden");
ok(/deliver: \(blob: Blob, filename: string\) => void = triggerDownload/.test(exp), "Desktop-Standard bleibt triggerDownload");

console.log(fail ? `\n${fail} FAIL` : "\nALL PASS");
process.exit(fail ? 1 : 0);
