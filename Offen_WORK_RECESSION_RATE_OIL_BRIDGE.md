# WORK_RECESSION_RATE_OIL_BRIDGE.md

Zwei Module neben den 17 Indikatoren. Sie gehen **nicht** in Netto/Max.
Sie erklären, warum Korrektur-P und Rezessions-P auseinanderlaufen können.

Serien: FRED `DCOILWTICO`, `GASREGW`, `CPIAUCSL`, `DGS10`, `DFII10`, `T10YIE`, `DFF`.

---

## 1. Zins-Brücke

Identität (täglich):

\[
\underbrace{i_{10}}_{\texttt{DGS10}} =
\underbrace{r_{10}}_{\texttt{DFII10}} +
\underbrace{\pi^{e}_{10}}_{\texttt{T10YIE}}
\]

Print 04.09.2026: \(T10YIE = 2{,}35\,\%\).

### Was die Brücke trennt

| \(\Delta\) | Buch | Mechanik |
|------------|------|----------|
| \(\Delta r_{10}\) (Realzins) | Korrektur **und** Rezession | WACC, Capex, Housing |
| \(\Delta \pi^e_{10}\) (Breakeven) | zuerst Korrektur | Multiples / Duration; Menge erst wenn persistent |
| \(\Delta i_{10}\) ohne Zerlegung | unlesbar | Mix |

Equity-Dauer (Faust, Growth lang):

\[
\frac{\Delta P}{P} \approx -D_{\mathrm{eq}}\,\Delta i_{10}
\]

\(D_{\mathrm{eq}}\approx 15\) bei g* 7 % / WACC 9 % (MSFT-Größenordnung).
\(+50\) bp Nominalzins \(\Rightarrow\) \(\approx -7{,}5\,\%\) Index, *ceteris paribus*.

### Score (Monitor, nicht 17er-Summe)

20J-\(z\) auf 13W-Δ:

- `z_real = z(Δ DFII10_13w)`
- `z_be   = z(Δ T10YIE_13w)`

Flag `rateTight = z_real > 1` → WACC-Druck, Korrektur-Buch.
Flag `stagflationWedge = z_be > 1 && z(Δ WEI) < 0` → Inflation oben, Menge weich.

Handlung liest Flags, nicht Hormuz-String.

---

## 2. Öl-Preis-Elastizität

### Mechanik CPI (US)

Benzin \(\approx 3{,}5\,\%\) CPI-Gewicht. Faust:

\[
\Delta \mathrm{CPI}_{\mathrm{hl}} \approx 0{,}035\cdot \Delta \%\,\mathrm{Gas}
\]

\(+\$20\) WTI bei stabiler Marge \(\approx +0{,}50\,\$/\mathrm{gal}\) \(\Rightarrow\) Headline \(+\approx 0{,}7\) pp (Convex/Öl-Breakeven-Kanal).

\(+\$10\)/bbl \(\approx +0{,}3\) bis \(+0{,}4\) pp Headline, Kern nahe 0 wenn Schock als temporär gilt (Kilian).

10J-Breakeven mechanisch: 1 pp Headline *ein Jahr* \(\approx 10\) bp auf \(T10YIE\).
Empirie großer Supply-Schocks: 50–100 bp — Rest ist Erwartungs-Update, nicht Benzin-Gewicht.

### Angebot kurzfristig

Dallas Fed wp2625 (Iran-Krieg 2026): US-Shale-Angebotselastizität 1M/1Q \(\approx 0\)
(Newell/Prest). Preis trägt den Schock, Menge kommt nicht in Wochen.

KC Fed 2026, skaliert auf +50 % WTI-Wachstum: ALQ \(+\approx 1\) pp, normalisiert \(\sim 3\) M;
PCE-Inflation persistenter (Jahre). Genau die Lag-Struktur der zwei Bücher.

WTI vor Schock \(\sim 61\), Peak \(\sim 115\) (Dallas Fed Abb. 2) = Supply-Shock,
nicht Demand — dann Stock-Öl-Korrelation negativ (SF Fed Letter 2026-21).

### Monitor (Code)

```
Δwti4w  = log(WTI_t / WTI_{t-20d})
z_oil   = z(Δwti4w) über 10J
shock   = z_oil > 1.5 AND corr_20d(SPX, WTI) < 0   // Supply, nicht Boom
passCPI = 0.035 * Δgas_8w                          // nur Label
passBE  = clip(0.10 * passCPI * 100, 0, 1.0) pp     // mechanische 10J-BE
```

UI-Zeile: „Öl +X % / 4W · Headline-Beitrag ~Y pp · mechan. 10J-BE ~Z bp · Realzins vs BE siehe Brücke.“
Kein Hormuz-Absatz, solange `shock===false`.

---

## Einbau in recession.ts

Neue Datei `server/recession-bridge.ts`:
`fetchBridge()` holt die 7 FRED-Serien (schon `getLatestFredValue`).
`runRecessionAnalysis` hängt `bridge: { rates, oil, flags }` an JSON.
`generateFazit` Abschnitt Geopolitik **ersetzt** den April-Text durch:

```
Wenn shock: eine Kette WTI→CPI→BE→DGS10, Zahlen aus bridge.
Wenn !shock: Abschnitt ausblenden.
```

Private-Credit-Essay bleibt getrennt (kein Öl).
