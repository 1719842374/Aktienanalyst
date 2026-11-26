/**
 * Schneller Schalter-Wächter, ohne Fixtures.
 * Importiert die echte Konstante aus shared/dcf-calibration.ts.
 * Ausführen:
 *   env -u FMP_API_KEY -u FRED_API_KEY -u RENDER_API_KEY -u OPENROUTER_API_KEY npx tsx script/test-dcf-flag-off.ts
 */
import { DCF_CALIBRATION } from "../shared/dcf-calibration";

const MESSAGE =
  "DCF_CALIBRATION.enabled muss false bleiben, bis Philip die Vorher/Nachher-Tabelle freigibt (#523).";

if (DCF_CALIBRATION.enabled !== false) {
  console.error(MESSAGE);
  console.error(
    `Import shared/dcf-calibration.ts: DCF_CALIBRATION.enabled ist ${String(DCF_CALIBRATION.enabled)}.`,
  );
  process.exit(1);
}

console.log("DCF_CALIBRATION.enabled ist false (Import shared/dcf-calibration.ts).");
