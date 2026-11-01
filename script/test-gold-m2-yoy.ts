/** JOB 19: M2 YoY aus echter FRED-M2SL-Reihe (nach Datum), 4.88 nur als echter Ersatz. */
import { readFileSync } from "fs";
import { computeM2YoyFromCsv } from "../server/gold-m2-yoy";
let fail = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${n}`); if (!ok) fail++; };

const asc = "observation_date,M2SL\n2025-07-01,22000\n2025-08-01,22092.6\n2026-07-01,23300\n2026-08-01,23342.8\n";
const r = computeM2YoyFromCsv(asc)!;
check("aufsteigend + Kopf observation_date (so liefert FRED live)", r && r.date === "2026-08-01" && r.yearAgoDate === "2025-08-01");
check("YoY = letzte vs. 12 Monate früher", Math.abs(r.yoy - (23342.8 / 22092.6 - 1) * 100) < 1e-9);
const desc = "DATE,M2SL\n2026-08-01,23342.8\n2026-07-01,23300\n2025-08-01,22092.6\n";
check("absteigend + Kopf DATE gleich", computeM2YoyFromCsv(desc)!.yoy === r.yoy);
check("fehlender Vorjahresmonat → null (Ersatz)", computeM2YoyFromCsv("observation_date,M2SL\n2026-08-01,23342.8\n2025-07-01,22000\n") === null);
check("leer/HTML → null", computeM2YoyFromCsv("") === null && computeM2YoyFromCsv("<html>") === null);
check("'.'-Werte ignoriert", computeM2YoyFromCsv("observation_date,M2SL\n2025-08-01,22092.6\n2026-08-01,.\n2026-07-01,23300\n2025-07-01,22000\n")!.date === "2026-07-01");

const fx = process.env.M2_FIXTURE;
if (fx) { const live = computeM2YoyFromCsv(readFileSync(fx, "utf8")); console.log("Fixture:", live); check("Fixture auswertbar", !!live); }

const src = readFileSync(new URL("../server/gold-routes.ts", import.meta.url), "utf8");
check("Route nutzt computeM2YoyFromCsv", src.includes("computeM2YoyFromCsv(await m2YoyCsvPromise)"));
check("alter Zeilenindex-Ansatz entfernt", !src.includes("m2Lines[12]"));
check("4.88 bleibt nur Ersatzwert", src.includes("let m2YoY = 4.88;"));
console.log(fail ? `\n${fail} Fehler` : "\nalle grün");
process.exit(fail ? 1 : 0);
