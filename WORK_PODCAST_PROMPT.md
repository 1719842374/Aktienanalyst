# WORK – Prompt für institutionelle Research-Podcasts (Goldman-/UBS-Niveau)

**Stand:** 26.10.2026  
**Ziel:** Detaillierter, wiederverwendbarer Prompt, der Podcast-Skripte im Stil institutioneller Research-Formate erzeugt (klar, flüssig, strukturiert, nicht redundant).

---

## Prompt (System)

```
Du bist ein Research-Podcast-Skriptschreiber auf institutionellem Niveau (Goldman Sachs / UBS Research) mit leichter All-In-Interaktion.

Aufgabe:
Erstelle ein Podcast-Skript zu dem gegebenen Thema und den gegebenen Daten.

Struktur (streng einhalten):
1. Hook (20–40 Sekunden gesprochen)
   - Thema nennen
   - Warum es jetzt relevant ist
   - Gast/Rolle kurz einführen

2. These (1–2 Minuten)
   - Eine klare Hauptaussage
   - Vollständige Sätze, keine Redundanz

3. Key Takeaways (3–5 Minuten)
   - Genau 2–3 klar getrennte Punkte
   - Jeder Punkt mit Daten oder Mechanismus
   - Nummerierung oder klare Übergänge

4. Mechanismus / Daten (4–6 Minuten)
   - Warum es so ist
   - Konkrete Kanäle, Zahlen, Quellen
   - Fachlich präzise, aber verständlich

5. Implikation (1–2 Minuten)
   - Was bedeutet das für Investoren
   - Handlungsorientiert, aber keine Anlageberatung

6. Abschluss (20–30 Sekunden)
   - Kurze Zusammenfassung
   - Disclaimer: „Dies ist keine Anlageberatung. KI-generiert im Research-Stil.“

Sprachregeln:
- Flüssig und natürlich.
- Keine Wiederholungen.
- Jeder Satz wird vollständig beendet.
- Keine abgehackten Formulierungen.
- Präzise, evidenzbasiert, institutionelles Niveau.
- Bei Zahlen immer die Quelle nennen, falls vorhanden.
- Leichte Interaktion zwischen Rollen (nicht monologisch).

Rollen (falls mehrere Sprecher):
- Host strukturiert und stellt Fragen.
- Experte liefert die Analyse.
- Reaktionen aufeinander, keine Monologe.

Ausgabeformat:
- Klar gekennzeichnete Abschnitte.
- Geschätzte Sprechzeit pro Abschnitt.
- Optional: Voice-Hinweise pro Sprecher.
```

---

## Zusammengeführtes Schema (Goldman / UBS / All-In)

**Gemeinsames Muster über alle drei Formate:**

1. **Hook / Intro** – Thema + Relevanz
2. **Thematische Blöcke** – 2–4 klar getrennte Segmente
3. **Interaktion** – Host ↔ Experte oder leichte Roundtable-Reaktion
4. **Implikation** – Was bedeutet das für Investoren
5. **Kennzeichnung** – Disclaimer

**Stil-Mix:**
- **Goldman/UBS:** Präzision, vollständige Sätze, Quellen, institutionelles Niveau.
- **All-In:** Leichte Interaktion zwischen Rollen (nicht monologisch), etwas conversationaler Ton.

Das Schema ist generisch und deckt beide Pole ab.

---

## RSI – Recursive Self-Improvement (Lernen aus eigenen Outputs)

**Ziel:** Der Podcast verbessert sich kontinuierlich anhand seiner eigenen bisherigen Ausgaben.

### Ablauf

1. **Generierung** – Skript wird wie oben erzeugt.
2. **Bewertung** – Ein zweiter Call bewertet das Skript gegen feste Kriterien:
   - Flüssigkeit (keine abgehackten Sätze)
   - Redundanz (Wiederholungen)
   - Struktur-Einhaltung
   - Quellenangaben
   - Interaktion zwischen Rollen
3. **Feedback speichern** – Bewertung + konkrete Verbesserungsvorschläge werden gespeichert.
4. **Nächster Lauf** – Das Feedback wird dem System-Prompt als zusätzlicher Kontext mitgegeben („Vermeide die Fehler aus dem letzten Lauf: …“).

### Bewertungsprompt (Beispiel)

```
Bewerte das folgende Podcast-Skript auf einer Skala von 1–10 für:
- Flüssigkeit
- Redundanzfreiheit
- Struktur-Einhaltung
- Quellenklarheit
- Rollen-Interaktion

Gib konkrete Verbesserungsvorschläge (max. 5 Punkte).
```

### Speicher

- Einfache JSON-Datei oder DB-Tabelle mit `timestamp`, `topic`, `score`, `feedback`.
- Beim nächsten Lauf werden die letzten 3–5 Feedbacks in den Prompt injiziert.

### Aufwand

| Schritt | Aufwand |
|---------|---------|
| Bewertungs-Call + Speicher | 4–6 h |
| Feedback-Injection in Prompt | 2–3 h |
| **Gesamt RSI** | **~6–9 h** |

**Ergebnis:** Jeder neue Podcast wird messbar besser als der vorherige, ohne manuelles Nachjustieren.

---

## Quellen – Global und Regional

### FMP News-Endpoints (strukturiert)

| Endpoint | Funktion |
|----------|----------|
| `/stable/news/stock-latest` | Aktuelle Aktien-News |
| `/stable/news/stock` | Aktien-News nach Symbol |
| `/stable/news/general-latest` | Allgemeine News |
| `/stable/news/press-releases-latest` | Pressemitteilungen |
| `/stable/news/press-releases` | Pressemitteilungen nach Symbol |
| `/stable/news/crypto-latest` | Krypto-News |
| `/stable/news/forex-latest` | Forex-News |
| `/stable/fmp-articles` | Eigene FMP-Artikel |

**Abdeckung:** Headlines, Snippets, URLs, Ticker. Gut als schnelle, strukturierte Quelle für US-/globale Aktien.

### Regionale und globale Qualitätsquellen

| Region | Quelle | Nutzen |
|--------|--------|--------|
| **Deutschland** | Handelsblatt, Manager Magazin, Börsen-Zeitung, FAZ | Unternehmens-, Politik- und Kapitalmarkt-Tiefe |
| **Europa** | NZZ, Financial Times, ECB, Bundesbank | Unabhängige Analyse, Geldpolitik |
| **USA** | Wall Street Journal, Bloomberg, Goldman/JPM Research | Märkte, institutionelle Sicht |
| **China** | Caixin, South China Morning Post | Unabhängige chinesische Perspektive |
| **Global** | The Economist, Google News | Makro, Geopolitik, Aggregation |

**Kombination:** FMP (strukturiert, API) + regionale Qualitätsmedien (Kontext) deckt das globale + lokale Bild ab.

---

## Implementierung – Dual Placement (Eigene Sektion + Asset-Integration)

### Ziel
Beides umsetzen:
1. **Eigene Podcast-Sektion** (Economist-/Spotify-ähnlich, mit Regionen).
2. **Integration in Asset-News** (Aktien, Gold, BTC, Rezession etc.) mit Scoring-Logik und Fazit.

### 1. Eigene Podcast-Sektion

**UI (Economist / Spotify-Niveau):**
- Player oben: Play, Fortschrittsbalken, Geschwindigkeit (1x/1.25x/1.5x), 15s Skip.
- Darunter: Fließtext des Transkripts (scrollbar, mit Zeitstempeln).
- Badge: „KI-generiert im Research-Stil“.
- Regionen-Filter: Deutschland / Europa / USA / China / Global.
- Kapitel-Sprünge: Hook, These, Takeaways, Mechanismus, Implikation.

**Daten:**
- Themen aus Dashboard (Buffett, CAPE, KI-Capex, Rezession, Gold etc.).
- Quellen: FMP + regionale Medien (siehe oben).

**Aufwand:** 8–12 h (Frontend Player + Backend Generierung + Regionen).

### 2. Integration in Asset-News (mit Scoring & Fazit)

**UI:**
- In der News-Sektion jedes Assets (Aktie, Gold, BTC, Rezession):
  - Button „Podcast zu diesem Asset“.
  - Generiert oder lädt eine asset-spezifische Episode.
  - Player + Transkript wie in der eigenen Sektion.

**Daten, die an den Podcast geschickt werden:**
- Asset-spezifische Daten (Kurs, Fundamentals).
- **Scoring-Logik / Bewertung:**
  - Ampel (ATTRAKTIV / NEUTRAL / UNATTRAKTIV).
  - Signal-Score (positiv / negativ / neutral).
  - Gates & Anti-Bias (DCF_REALITY_CHECK, PRICING_POWER, INVENTORY etc.).
  - Technische Analyse (RSI, MACD, Death Cross / Golden Cross, RSL).
  - Fundamentale Bewertung (gehärteter Inverse-DCF, g*, WACC).
  - Moat / Porter, PESTEL, Management-Score.
- FMP Stock News + regionale Quellen.

**Podcast-Inhalt (zusätzlich zur Standardstruktur):**
- Kurze Erklärung der Scoring-Logik im Kontext des Assets.
- Fazit: Technische Analyse + Fundamentale Bewertung + Gesamtampel.
- Warum die Ampel so steht (Top-Treiber und Red Flags).

**Aufwand:** 12–16 h (Asset-Kontext, Scoring-Payload, Generierung pro Asset, Caching).

### Gesamtaufwand Dual Placement

| Schritt | Aufwand |
|---------|---------|
| Eigene Podcast-Sektion | 8–12 h |
| Asset-Integration (inkl. Scoring & Fazit) | 12–16 h |
| **Gesamt Placement** | **~20–28 h** |

**Empfehlung:** Beide parallel umsetzen. Die eigene Sektion als Hauptansicht, die Asset-Integration als kontextueller Einstieg mit voller Scoring-Erklärung.

---

## Beispiel-Aufruf (User)

```
Thema: KI-Capex und Bewertung 2026
Daten:
- Buffett-Indikator: 245 % (Yahoo ^W5000 / FRED GDP)
- Shiller CAPE: 40.4 (Multpl)
- VIX: 19.0 (FRED VIXCLS)
- Hyperscaler-Capex stark steigend
- Realzinsen stabil

Rollen: Host + Macro Strategist + Credit Analyst
```

---

## Hinweise zur Nutzung

- Der Prompt erzwingt die Goldman-/UBS-Struktur mit leichter All-In-Interaktion.
- Stilregeln verhindern Redundanz und abgehackte Sätze.
- Für Multi-Voice: Abschnitte mit Sprecher-Tags versehen, dann an TTS weitergeben.
- Filter (öffentliche Daten only) vorher anwenden.
- Kennzeichnung „KI-generiert“ ist im Abschluss enthalten.
- RSI-Loop läuft automatisch nach jedem Podcast.
- Quellen: FMP für strukturierte News, regionale Medien für Kontext.
- Dual Placement: Eigene Sektion + Asset-Integration (mit Scoring & Fazit).

---

## Aufwand für Integration

| Schritt | Aufwand |
|---------|---------|
| Prompt in Pipeline einbauen | 2–3 h |
| Multi-Rollen-Logik | 4–6 h |
| TTS-Anbindung | 6–8 h |
| RSI-Loop | 6–9 h |
| Quellen-Anbindung (FMP + regional) | 4–6 h |
| Dual Placement (eigene Sektion + Asset mit Scoring) | 20–28 h |
| **Gesamt** | **~42–60 h** |

Der Prompt ist generisch und für alle Research-Themen einsetzbar.
