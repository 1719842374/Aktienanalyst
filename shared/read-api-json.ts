/**
 * Liest eine Fetch-Antwort, ohne HTML an JSON.parse zu geben.
 * Gateway-Timeouts und der SPA-Fallback von Render liefern `<!DOCTYPE html>`.
 * res.json() macht daraus „Unexpected token '<' … is not valid JSON“.
 */

export async function readApiJson(
  res: Response,
): Promise<{ ok: true; json: unknown } | { ok: false; reason: string }> {
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  const text = await res.text();
  const trimmed = text.trim();
  if (contentType.includes("text/html") || trimmed.startsWith("<")) {
    return {
      ok: false,
      reason: "n/a — Antwort war HTML statt JSON (Gateway-Timeout oder SPA-Fallback)",
    };
  }
  if (contentType && !contentType.includes("json") && !contentType.includes("text/plain")) {
    const short = contentType.split(";")[0]?.trim() || contentType;
    return { ok: false, reason: `n/a — unerwarteter Content-Type ${short}` };
  }
  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return { ok: false, reason: "n/a — Antwort war kein gültiges JSON" };
  }
}

export function naReasonFromError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (msg.startsWith("Timeout:") || /zeitüberschreitung|aborted|abort/i.test(msg)) {
    return "n/a — Zeitüberschreitung, die Karte hat nicht rechtzeitig geantwortet";
  }
  if (msg.includes("Unexpected token") || msg.includes("<!DOCTYPE") || msg.includes("is not valid JSON")) {
    return "n/a — Antwort war HTML statt JSON (Gateway-Timeout oder SPA-Fallback)";
  }
  if (msg.startsWith("n/a")) return msg;
  return `n/a — ${msg || "Weltkarte fehlgeschlagen"}`;
}
