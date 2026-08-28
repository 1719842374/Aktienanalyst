# WORK_TAM_SEGMENT_MAPPING.md — Segment-TAM Mapping & Weighted-TAM Qualitätstor

> **Stand:** 28.08.2026
> **Status:** Spec fertig · Implementierung offen
> **Referenz:** MSFT Section-7 Screenshot (Server $250B / 51,8 % Share, fünf Segmente auf $1.500B Cloud, Karte $896B)
> **Dateien:** `server/sector-data.ts` (`matchSegmentTAM`, `generateTAMAnalysis`), `client/src/components/sections/Section7.tsx`
> **Verwandt:** [WORK_SEGMENT_DEDUP.md](./WORK_SEGMENT_DEDUP.md) (andere Schicht: Name-Duplikate Produkt vs. Geo)
> **Eintrag in:** [WORK.md](./WORK.md)

**Regel:** Dokumentation. Implementierung lokal → PR → Review. Keine Research-API, kein LLM im Hot Path.

---

## 0. Ziel für das Analysesystem

Segment-TAM ist die **Plausibilitätsbremse für DCF-g**, nicht ein Relativ-Multiple.

- Relativbewertung (P/E vs. Sektor) bleibt Kosmetik.
- DCF-Upside + Katalysator-GB + Reverse-DCF bleiben die Entscheidung.
- Segment-TAM darf `g1` / segmentgewichteten CAGR **nur** deckeln, wenn das Mapping divers und coverage-stark ist.
- Sonst: Konzern-g + Reverse DCF, Tabelle als `unreliable` markieren.

Ticker-agnostisch. MSFT ist der Repro-Fall, nicht der einzige Fix.

---

## 1. Ist-Zustand (Code)

### 1.1 Zwei Pfade in `generateTAMAnalysis`

Datei: `server/sector-data.ts`.

| Pfad | Bedingung | Ergebnis |
|------|-----------|----------|
| A Konzern-Dummy | `< 2` Segmente | ein Branchen-TAM (Tech+Azure → Cloud $1.500B / 16 %) |
| B Segment-Mix | `≥ 2` Segmente | je Segment `matchSegmentTAM(name, companyDescription)`, dann gewichtet |

Pfad B (MSFT):

```ts
weightedTAM   = Σ tamSize_i * (segmentShare_i / 100)
weightedCAGR  = Σ tamCAGR_i * (segmentShare_i / 100)
marketShare   = companyRevenueB / weightedTAM
```

`segmentShare_i` = FMP-`percentage` (Umsatzmix), **nicht** Weltmarktanteil.
`tamSize_i` = Hardcode-Katalog, First-Match auf Segment**namen**, sonst Fallback auf Konzern-`desc`.

### 1.2 `matchSegmentTAM` — Reihenfolge (Ist)

First-Match, Substring, case-insensitive auf `segName`:

| Prio | Keyword | Katalog TAM | CAGR | Label |
|------|---------|-------------|------|-------|
| 1 | `cloud` \| `azure` \| `aws` \| `infrastructure` | 1500 | 16 | Global Cloud Computing |
| 2 | `productiv` \| `office` \| `business process` \| `collaboration` | 600 | 12 | Productivity & Collaboration |
| 3 | `windows` \| `gaming` (ohne Casino) \| `device` \| `hardware` \| `surface` | 400 | 3 | PC & Gaming |
| 4 | `advertis` \| `search` | 1000 | 10 | Digital Advertising |
| 5 | `storage` \| `enterprise` \| `mainframe` \| `server` | 250 | 6 | Enterprise IT Infrastructure |
| Fallback A | **Konzern-desc** enthält `cloud`/`azure`/`aws` | 1500 | 16 | Global Cloud Computing |
| Fallback B | nichts | 2000 | 5 | Global Industry |

Weitere Branchenregeln (Pharma, Semi, Luxury, …) sitzen dazwischen; für den MSFT-Repro sind die Zeilen oben entscheidend.

### 1.3 Warum MSFT kollabiert

FMP-Namen vs. Matcher:

| Segment (Screenshot) | Rev | Mix | Treffer Ist | TAM Ist | Share Ist |
|----------------------|-----|-----|-------------|---------|-----------|
| Server | $129.4B | 39.0 % | Prio 5 `server` | **$250B / 6 %** | **51.8 %** |
| Microsoft 365 Commercial | $102.0B | 30.7 % | kein `office`/`productiv`/`365` | Fallback desc → **Cloud $1.500B** | 6.8 % |
| XBOX | $21.8B | 6.6 % | Name ≠ `gaming` | Fallback desc → Cloud $1.500B | 1.5 % |
| Linked In | $19.8B | 6.0 % | kein Keyword | Fallback desc → Cloud $1.500B | 1.3 % |
| Windows | $17.1B | 5.1 % | Prio 3 `windows` | $400B / 3 % | 4.3 % |
| Search Advertising | $15.2B | 4.6 % | Prio 4 `search` | $1.000B / 10 % | 1.5 % |
| Microsoft 365 Consumer | $9.2B | 2.8 % | wie M365 Comm | Cloud $1.500B | 0.6 % |
| Dynamics | $9.0B | 2.7 % | kein `business process` | Cloud $1.500B | 0.6 % |

Konzernbeschreibung von MSFT enthält immer Azure. Jedes ungemappte Segment erbt **denselben** Cloud-Dummy.

### 1.4 $896B ist kein Additionsfehler

Summe der TAM-**Spalte** = \(250 + 5\times1500 + 400 + 1000 = 9{,}150\) — wird **nirgends** summiert.

Karte $896B = gewichteter Mittelwert der (falschen) Katalogwerte:

```
0.390*250 + 0.307*1500 + 0.066*1500 + 0.060*1500
+ 0.051*400 + 0.046*1000 + 0.028*1500 + 0.027*1500
= 97.5 + 460.5 + 99.0 + 90.0 + 20.4 + 46.0 + 42.0 + 40.5
= 896.0
```

Marktanteil-Karte: \(331.8 / 896 \approx 37.04\,\%\).

Ökonomisch wertlos: Durchschnitt unvergleichbarer Pools + fünfmal derselbe $1.500B-Kuchen + Server-Kasten zu klein für $129B Azure-lastigen Umsatz.

`tamSource` listet Labels **ohne** `Set` → Fußzeile „Cloud Computing, Cloud Computing, …“. `tamLabel` oben nutzt bereits `Set`.

Mix der 8 Zeilen ≈ 97.5 %, Restumsatz nicht in `weightedTAM`.

---

## 2. Soll-Zustand (adaptiv, alle Aktien)

### 2.1 Prinzipien

1. Segment-TAM = SAM **dieser Produktkategorie**, nicht Konzern-Story.
2. Kein Fallback über Konzern-`description`. Unmatched → `matched: false`, TAM/CAGR/Share `null`.
3. Konzern-Karte `weightedTAM` nur wenn Qualitätstor grün.
4. DCF darf segmentgewichteten CAGR nur nutzen, wenn dasselbe Tor grün ist.
5. Alias-Liste ist **erweiterbar**, Default-Verhalten ohne Alias = N/A, nicht Cloud.
6. Keine Ticker-Hardcodes (`if (ticker === 'MSFT')`).

### 2.2 Qualitätstor (eine Funktion, überall gleich)

```ts
export type TamQuality = 'ok' | 'weak' | 'unreliable';

export function assessTamQuality(input: {
  segments: Array<{ matched: boolean; tamLabel: string | null; segmentShare: number; marketShare: number | null }>;
  coveragePct: number; // Umsatzanteil mit matched === true
}): {
  quality: TamQuality;
  distinctLabels: number;
  coveragePct: number;
  highShareFlags: number;
  reasons: string[];
} {
  const matched = input.segments.filter(s => s.matched && s.tamLabel);
  const distinctLabels = new Set(matched.map(s => s.tamLabel as string)).size;
  const highShareFlags = matched.filter(s => (s.marketShare ?? 0) > 25).length;
  const reasons: string[] = [];

  if (input.coveragePct < 70) reasons.push(`coverage_${input.coveragePct}`);
  if (distinctLabels < 2) reasons.push(`distinct_labels_${distinctLabels}`);
  if (highShareFlags > 0) reasons.push(`share_gt_25_x${highShareFlags}`);

  let quality: TamQuality = 'ok';
  if (input.coveragePct < 70 || distinctLabels < 2) quality = 'unreliable';
  else if (highShareFlags > 0) quality = 'weak';

  return { quality, distinctLabels, coveragePct: input.coveragePct, highShareFlags, reasons };
}
```

| Tor | UI-Karte TAM / CAGR / Konzern-Share | DCF-g |
|-----|--------------------------------------|-------|
| `ok` | anzeigen | segmentgewichteter TAM-CAGR darf `g1` nach oben deckeln |
| `weak` | anzeigen + Banner „Share-Check“ | deckeln nur mit Haircut / Kommentar |
| `unreliable` | Karte: „Segment-TAM unzuverlässig“ | **kein** Segment-CAGR in DCF; Konzern-g + Reverse DCF |

Schwellen (konstant, oben im File dokumentieren):

```ts
const TAM_COVERAGE_MIN = 70;      // % Umsatz mit matched TAM
const TAM_DISTINCT_LABELS_MIN = 2;
const TAM_SHARE_WARN = 25;        // Segmentumsatz / TAM_i
```

---

## 3. Mapping-Engine (Soll)

### 3.1 Normalisierung

```ts
export function normalizeSegmentKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bsegment\b/g, '')
    .trim();
}
```

### 3.2 Katalog (bestehende Zahlen behalten, nur Treffer ändern)

Kein neues Research. IDs stabil, damit Tests nicht an Gartner-Updates hängen.

```ts
export const TAM_CATALOG = {
  CLOUD:            { tamSize: 1500, tamCAGR: 16, tamLabel: 'Global Cloud Computing', tamSource: 'Gartner/IDC Cloud Forecast' },
  PRODUCTIVITY:     { tamSize: 600,  tamCAGR: 12, tamLabel: 'Global Productivity & Collaboration Software', tamSource: 'Gartner SaaS/Productivity Forecast' },
  ENTERPRISE_APPS:  { tamSize: 400,  tamCAGR: 12, tamLabel: 'Global ERP/CRM & Enterprise Applications', tamSource: 'Gartner Enterprise Apps' },
  PC_GAMING:        { tamSize: 400,  tamCAGR: 3,  tamLabel: 'Global PC & Gaming Market', tamSource: 'IDC/Gartner PC & Gaming Forecast' },
  DIGITAL_ADS:      { tamSize: 1000, tamCAGR: 10, tamLabel: 'Global Digital Advertising', tamSource: 'eMarketer / GroupM' },
  TALENT:           { tamSize: 80,   tamCAGR: 8,  tamLabel: 'Global Talent Solutions & Professional Network', tamSource: 'Industry Estimate Recruiting/Talent' },
  ENTERPRISE_IT:    { tamSize: 250,  tamCAGR: 6,  tamLabel: 'Global Enterprise IT Infrastructure', tamSource: 'IDC Enterprise IT' },
  // bestehende Einträge Pharma, Semi, Luxury, Energy, … unverändert lassen
} as const;
```

`TALENT` und `ENTERPRISE_APPS` sind die einzigen neuen Pools — nötig, damit LinkedIn/Dynamics nicht in Cloud fallen. Werte konservativ/klein, damit Share nicht explodiert; lieber N/A als 51 %.

### 3.3 Alias-Tabelle (erweiterbar, nicht tickergebunden)

Reihenfolge: **längster / spezifischster Alias zuerst**, danach generische Substrings. `infrastructure` darf **nicht** vor Azure/Cloud stehen und Cloud erzwingen, wenn der Name `server` ist.

```ts
/** Test gegen normalizeSegmentKey(name). Erstes Match gewinnt. */
export const TAM_ALIASES: Array<{ test: RegExp; catalog: keyof typeof TAM_CATALOG }>= [
  // Cloud / Hyperscale — nur klare Cloud-Wörter
  { test: /\b(azure|aws|amazon web services|google cloud|gcp|intelligent cloud|public cloud)\b/, catalog: 'CLOUD' },
  { test: /\bcloud\b/, catalog: 'CLOUD' },

  // Productivity / M365
  { test: /\b(microsoft 365|office 365|m365|365 commercial|365 consumer)\b/, catalog: 'PRODUCTIVITY' },
  { test: /\b(office|productivity|collaboration|workplace)\b/, catalog: 'PRODUCTIVITY' },

  // Enterprise Apps (nicht Cloud)
  { test: /\b(dynamics|salesforce|erp|crm|business applications)\b/, catalog: 'ENTERPRISE_APPS' },
  { test: /\bbusiness process\b/, catalog: 'ENTERPRISE_APPS' },

  // Gaming
  { test: /\b(xbox|playstation|nintendo|console)\b/, catalog: 'PC_GAMING' },
  { test: /\bgaming\b/, catalog: 'PC_GAMING' },

  // OS / Devices
  { test: /\b(windows|surface|personal comput|pc oem)\b/, catalog: 'PC_GAMING' },

  // Ads vs Talent
  { test: /\b(linkedin|talent|recruiter|jobs network)\b/, catalog: 'TALENT' },
  { test: /\b(advertis|search ads|youtube ads|google services)\b/, catalog: 'DIGITAL_ADS' },
  { test: /\bsearch\b/, catalog: 'DIGITAL_ADS' },

  // Legacy server hardware / on-prem — NICHT Azure
  { test: /\b(windows server|sql server|on[- ]prem)\b/, catalog: 'ENTERPRISE_IT' },
  { test: /\b(mainframe|storage hardware)\b/, catalog: 'ENTERPRISE_IT' },
];
```

**Bewusst nicht:** `server` → $250B. Bei MSFT/AMZN ist „Server“ / „AWS“ Cloud-lastig. Ohne Qualifier (`windows server`, `on-prem`) lieber:

- Name enthält `azure|aws|cloud` → CLOUD
- sonst `server` allein → **unmatched** (N/A), nicht 51 % von $250B

Das ist der adaptive Kern: lieber eine N/A-Zeile als einen falschen Mini-Markt.

### 3.4 Neue Signatur — kein `desc`-Fallback

```ts
export function matchSegmentTAM(
  segName: string,
  _desc?: string // deprecated, ignorieren
): {
  matched: boolean;
  tamSize: number | null;
  tamLabel: string | null;
  tamCAGR: number | null;
  tamSource: string | null;
} {
  const key = normalizeSegmentKey(segName);
  for (const rule of TAM_ALIASES) {
    if (rule.test.test(key)) {
      const c = TAM_CATALOG[rule.catalog];
      return { matched: true, ...c };
    }
  }
  // bestehende Branchen-Keywords (pharma, semi, luxury, …) hier als weitere Regeln
  // KEIN: if (desc.includes('cloud')) …
  return { matched: false, tamSize: null, tamLabel: null, tamCAGR: null, tamSource: null };
}
```

Alte Aufrufer `matchSegmentTAM(name, desc)` bleiben kompilierbar, `desc` wird ignoriert.

### 3.5 `generateTAMAnalysis` — Soll

```ts
const segTAMs = revenueSegments.map(seg => {
  const match = matchSegmentTAM(seg.name);
  const segRevB = seg.revenue / 1e9;
  const marketShare = match.matched && match.tamSize
    ? Math.round((segRevB / match.tamSize) * 10000) / 100
    : null;
  const segGrowth = typeof seg.growth === 'number' && isFinite(seg.growth) ? seg.growth : null;
  return {
    segmentName: seg.name,
    segmentRevenue: Math.round(segRevB * 10) / 10,
    segmentGrowth: segGrowth,
    segmentShare: seg.percentage,
    matched: match.matched,
    tamSize: match.tamSize,
    tamLabel: match.tamLabel,
    tamCAGR: match.tamCAGR,
    marketShare,
    outperforming: match.matched && segGrowth !== null && match.tamCAGR !== null
      ? segGrowth > match.tamCAGR
      : null,
    shareWarning: marketShare !== null && marketShare > TAM_SHARE_WARN,
  };
});

const matchedForWeight = segTAMs.filter(s => s.matched && s.tamSize && s.segmentShare > 0);
const coveragePct = matchedForWeight.reduce((s, x) => s + x.segmentShare, 0);

const quality = assessTamQuality({
  segments: segTAMs,
  coveragePct,
});

// Gewichtung NUR über matched Zeilen, Mix auf coverage renormieren
const weightedTAM = quality.quality === 'unreliable' || coveragePct <= 0
  ? null
  : matchedForWeight.reduce((s, x) => s + (x.tamSize as number) * (x.segmentShare / coveragePct), 0);

const weightedCAGR = quality.quality === 'unreliable' || coveragePct <= 0
  ? null
  : matchedForWeight.reduce((s, x) => s + (x.tamCAGR as number) * (x.segmentShare / coveragePct), 0);

const tamSource = [...new Set(
  matchedForWeight.map(s => (s.tamLabel || '').replace(/^Global /, '')).filter(Boolean)
)].join(', ');
```

Wenn `quality === 'unreliable'`: `tamTotal = null`, `marketShare = null`, `tamLabel = 'Segment-TAM unzuverlässig'`.

Pfad A (`< 2` Segmente) bleibt Konzern-Dummy, setzt `quality: 'weak'` und `distinctLabels: 1`.

---

## 4. UI (`Section7.tsx`)

| Element | Soll |
|---------|------|
| Karte TAM | Zahl nur bei `ok` / `weak`. Bei `unreliable`: Text statt $896B |
| Karte Marktanteil | nur wenn `tamTotal` gesetzt |
| Zeile unmatched | TAM / CAGR / Anteil am TAM / vs TAM = `n/a`, Zeile gedimmt |
| `shareWarning` | Badge „Share > 25 % — TAM vermutlich zu eng“ |
| Fußzeile `tamSource` | dedupliziert (Set), plus `quality` + Coverage |
| Banner | `unreliable`: „Mapping unvollständig — DCF nutzt Konzern-g, nicht Segment-CAGR“ |

Keine Chart-Pattern, kein Accel-Score. Nur Qualität des TAM-Blocks.

---

## 5. DCF-Kopplung (eng)

In der DCF-Annahme-Schicht (wo `tam.tamCAGR` / `outperforming` heute implizit die Story füttern können):

```ts
function dcfGrowthCapFromTam(tam: {
  quality: TamQuality;
  tamCAGR: number | null;
  companyGrowth: number;
}): { useSegmentCagr: boolean; note: string } {
  if (tam.quality !== 'ok' || tam.tamCAGR == null) {
    return { useSegmentCagr: false, note: 'Konzern-g + Reverse DCF (Segment-TAM unreliable/weak)' };
  }
  return { useSegmentCagr: true, note: 'g1 ≤ max(companyGrowth, tamCAGR + share-shift Begründung)' };
}
```

`weak` (Share-Flag): Segment-CAGR **nicht** als Freibrief für höheres `g1`. Nur Kommentar in Sektion 5.

Katalysator-GB bleibt segmentbezogen über den **Namen** (Azure, M365), nicht über den Dummy-TAM.

---

## 6. Erwartetes MSFT-Bild nach Fix (ohne neue Marktzahlen)

| Segment | Match | TAM |
|---------|-------|-----|
| Server | unmatched (nacktes `server`) | n/a + Coverage-Loch |
| Microsoft 365 Commercial | PRODUCTIVITY | $600B / 12 % |
| XBOX | PC_GAMING | $400B / 3 % |
| Linked In | TALENT | $80B / 8 % |
| Windows | PC_GAMING | $400B / 3 % |
| Search Advertising | DIGITAL_ADS | $1.000B / 10 % |
| Microsoft 365 Consumer | PRODUCTIVITY | $600B / 12 % |
| Dynamics | ENTERPRISE_APPS | $400B / 12 % |

Coverage ohne Server ≈ 58.5 % → Tor **`unreliable`** → Karte nicht $896B, DCF ohne Segment-CAGR.

Wenn später FMP „Intelligent Cloud“ / „Azure“ liefert: Alias `azure|intelligent cloud` → CLOUD $1.500B, Share \(129.4/1500 \approx 8.6\,\%\) < 25 %, Coverage steigt, Tor kann auf `ok`/`weak` wechseln.

Das ist gewollt: **kein schöner 51,8 %-Server-Wert**.

---

## 7. Fixtures (Acceptance, ticker-übergreifend)

| Ticker / Input | Erwartung |
|----------------|-----------|
| MSFT Ist-Namen (Screenshot) | M365→Productivity, Xbox→Gaming, LinkedIn→Talent, Dynamics→Apps, Server→unmatched, Karte unreliable solange Coverage < 70 |
| MSFT wenn Segment „Azure“ oder „Intelligent Cloud“ | CLOUD $1500, Share < 25 % |
| AMZN „Amazon Web Services“ | CLOUD, nicht ENTERPRISE_IT |
| AMZN „Online Stores“ | E-Commerce-Regel (bestehend), nicht Cloud-desc |
| AAPL „iPhone“ ohne Alias | unmatched, nicht desc-Fallback Services/Cloud |
| NVDA „Data Center“ | bestehende AI/Data-Center-Regel |
| Ein-Segment-Titel | Pfad A, quality `weak`, kein weighted Mix |
| Casino + `gaming` im Namen | Casino-Regel vor PC_GAMING (Reihenfolge beibehalten) |
| Unmatched-only, 4 Segmente | quality `unreliable`, DCF ohne Segment-CAGR |

Unit-Tests in `script/test-tam-segment-mapping.ts` (kein Live-FMP nötig): reine `matchSegmentTAM` + `assessTamQuality` + Weighted-Formel mit den Screenshot-Zahlen als Regression (`expect(oldWeighted).toBe(896)` im *Legacy*-Snapshot, neuer Pfad ≠ 896).

---

## 8. Betroffene Dateien

| Datei | Änderung |
|-------|-----------|
| `server/sector-data.ts` | `TAM_CATALOG`, `TAM_ALIASES`, `normalizeSegmentKey`, `matchSegmentTAM` ohne desc-Fallback, `assessTamQuality`, `generateTAMAnalysis` Quality-Tor, `tamSource` via Set |
| `shared/schema.ts` | `matched`, `tamSize: number \| null`, `quality`, `distinctLabels`, `shareWarning` |
| `client/src/components/sections/Section7.tsx` | Karte/Banner/n/a-Zellen |
| DCF-Builder (analyze-route / calculations) | `dcfGrowthCapFromTam` — Segment-CAGR nur bei `quality === 'ok'` |
| `script/test-tam-segment-mapping.ts` | Fixtures oben |
| `WORK.md` | Link auf diese Datei |

`Section2` unverändert (andere Segment-Liste). Dedup bleibt [WORK_SEGMENT_DEDUP.md](./WORK_SEGMENT_DEDUP.md).

---

## 9. Reihenfolge der Umsetzung

1. Katalog + Aliase + `matchSegmentTAM` ohne desc-Fallback + Tests (MSFT-Namen, AMZN AWS, AAPL unmatched).
2. `assessTamQuality` + `generateTAMAnalysis` gibt `null` statt Dummy-$896B.
3. Schema + Section7 Banner / n/a.
4. DCF-Cap verdrahten.
5. Manuell: MSFT, AMZN, ASML, NVO, ein Small Cap ohne Segmente.
6. PR.

Nicht in diesem Ticket: Live-Gartner-API, Climax/RS, Accel-Faktor, Relativ-P/E neu gewichten.

---

## 10. Acceptance-Checkliste

- [ ] `matchSegmentTAM('Microsoft 365 Commercial')` → PRODUCTIVITY $600B, nicht Cloud
- [ ] `matchSegmentTAM('XBOX')` → PC_GAMING
- [ ] `matchSegmentTAM('Linked In')` → TALENT, nicht Cloud
- [ ] `matchSegmentTAM('Dynamics')` → ENTERPRISE_APPS
- [ ] `matchSegmentTAM('Server')` → unmatched (kein $250B / 51,8 %)
- [ ] `matchSegmentTAM('Amazon Web Services', 'retail desc')` → CLOUD (desc ignoriert, Name reicht)
- [ ] `matchSegmentTAM('iPhone', 'Apple … cloud …')` → unmatched (kein desc-Fallback)
- [ ] `tamSource` ohne wiederholte „Cloud Computing“
- [ ] MSFT Screenshot-Mix → `quality === 'unreliable'` solange Server unmatched und Coverage < 70
- [ ] UI zeigt dann keinen $896B-Konzern-TAM
- [ ] DCF nutzt in diesem Zustand Konzern-g + Reverse DCF
- [ ] `marketShare > 25` setzt `shareWarning`, quality mindestens `weak`
- [ ] Kein `if (ticker === 'MSFT')`
- [ ] Casino/gaming-Reihenfolge regressiert nicht
- [ ] WORK_SEGMENT_DEDUP unberührt

---

## 11. Zahlen-Anhang (Regression Snapshot 28.08.2026)

MSFT UI, unverändert vor Fix:

- Kurs-Kontext Section 7: Relativblock egal für dieses Ticket
- Konzernumsatz in Karte: **$331.8B**
- Karte TAM **$896B**, CAGR **10.8 %**, Share **37.04 %**, YoY **+17.8 %**
- Segment-gew. Wachstum **+21.3 %**, Coverage **91 %** (YoY-Coverage, nicht Mapping-Qualität)
- Server: $129.4B / 39.0 % / +31.5 % / TAM $250B / 6 % / Share 51.8 % / Über
- M365 Commercial: $102.0B / 30.7 % / +16.2 % / $1.500B / 16 % / 6.8 % / Über
- Formelbeweis Karte: siehe §1.4 = 896.0 exakt mit Mix-Gewichten

Nach Fix darf diese 896-Zahl **nicht** als „ok“ weiterleben, solange Server unmatched oder Labels nicht divers sind.

---

*Spec erstellt 28.08.2026 · geschätzt 3–5 h inkl. Tests · kein API-Kosten-Impact*
