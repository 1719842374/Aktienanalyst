# WORK – Adaptive KI-Podcast Pipeline (Goldman-Sachs-Niveau)

**Stand:** 26.10.2026  
**Ziel:** Professionelle, adaptive Podcast-Pipeline über OpenRouter (Whisperflow-ähnlich) mit multiplen Rollen, Stilkontrolle und klarer rechtlicher Kennzeichnung. Niveau: institutionell, klar, nicht redundant.

---

## 1. Technische Grundlage (OpenRouter Audio)

| Endpoint | Funktion | Modelle (Stand 26.10.2026) | Nutzung |
|----------|----------|----------------------------|---------|
| `/api/v1/audio/transcriptions` | Speech-to-Text | Whisper Large V3, Whisper Large V3 Turbo, GPT-4o Transcribe | Audio → Text |
| `/api/v1/audio/speech` | Text-to-Speech | OpenAI, Google, Mistral Voices | Text → Audio |

**Zahlen:**
- Whisper Large V3 Turbo: ~15,4 Mio. Requests/Woche auf OpenRouter (führend).
- OpenAI-Anteil bei Transkriptionen: ~65 %.
- Kosten: Transkription günstig; TTS abhängig von Länge und Voice.

**Pipeline:**
1. Audio (legale Quelle) → Transkription.
2. Chat-Modell → strukturiertes Skript (Rollen + Stilregeln).
3. Speech-Endpoint → Audio (eine oder mehrere Stimmen).

**Rechtlich:** Spotify-Downloads problematisch (ToS). Bevorzugt: offizielle Transkripte, YouTube, lizenzierte Feeds.

---

## 2. Stilkontrolle (flüssig, nicht redundant)

**Problem:** KI neigt zu Wiederholungen und abgehackten Sätzen.

**Lösung (Prompt + Pipeline):**
- System-Prompt: „Schreibe flüssig und natürlich. Vermeide Wiederholungen. Beende jeden Satz vollständig.“
- Zwei-Schritt: Rohzusammenfassung → Stil-Pass.
- TTS Delivery-Instructions: „speak naturally, with clear sentence endings“.

**Zielniveau:** Goldman-Sachs-Research-Stil – präzise, strukturiert, keine Füllsätze.

---

## 3. Rollen-Panel (adaptiv, nicht hardcodiert)

| Rolle | Perspektive | Fokus | Vermeiden |
|-------|-------------|-------|-----------|
| Value Investor | Cashflows, Bewertung, Moats | Valuation, Margin of Safety | Reines Momentum |
| Technology Builder | Skalierung, Disruption | Adoption, Infrastruktur | Reine Bewertungsdebatten |
| AI Researcher | Modelle, Compute, Grenzen | Capabilities, Limitations | Hype ohne Basis |
| Macro Strategist | Liquidität, Zinsen, Zyklen | Rates, Flows | Einzelaktien-Details |
| Credit Analyst | Hebel, Spreads, Ausfall | Balance Sheet, Defaults | Reine Wachstums-Narrative |
| Contrarian | Gegenposition, Blasenrisiko | Consensus Risk | Unhinterfragte Narrative |

**Rechtlich:** Klar als „KI-generiert im Stil von…“ kennzeichnen. Keine echten Stimmen ohne Rechte.

---

## 4. Regional / Global

- **Global:** Goldman, JP Morgan, All-In, UBS, Economist.
- **Europa/Deutschland:** Handelsblatt, FAZ, ECB, Bundesbank, lokale Quellen.
- Pipeline bleibt gleich; Sprache und Quellen wechseln. OpenRouter Whisper unterstützt Sprach-Hints (DE/EN).

---

## 5. Übertragbarkeit Voice-Agent (gods-eye-view)

**Projekt:** https://github.com/bilawalsidhu/gods-eye-view  
- 3D-Globus (CesiumJS) + OpenAI Realtime / Gemini Voice.  
- Architektur: `src/voice/` – Realtime Session + Tools + Live-Kontext.

**Übertragbarkeit auf Aktienanalyst:**
- **Nicht 1:1** (CesiumJS / Geospatial nicht relevant).
- **Konzeptuell ja:** Realtime + Tools + Kontext-Pull.
  - Statt Globe → Dashboard-Sektionen (Technical, Scoring, DCF).
  - Statt „Take me to Tokyo“ → „Zeige Buffett-Indikator“ / „Override g1“.
- Tool-Definition und Kontext-Übergabe sind übertragbar.

---

## 6. Implementierungsaufwand (Schätzung)

| Komponente | Aufwand |
|------------|---------|
| Audio-Ingestion + Transkription (OpenRouter) | 8–12 h |
| Rollen-Prompt-Engine + Filter | 6–8 h |
| Stil-Pass + Skript-Generierung | 4–6 h |
| TTS + Multi-Voice | 6–8 h |
| UI (Upload, Player, Transkript) | 8–12 h |
| **Gesamt** | **~32–46 h** |

---

## 7. Akzeptanzkriterien

1. Audio → Transkript → Skript → Audio funktioniert end-to-end.
2. Mindestens 4 Rollen reagieren aufeinander.
3. Stil ist flüssig, keine abgehackten Sätze.
4. Klare Kennzeichnung „KI-generiert“.
5. Filter blockiert nicht-öffentliche / spekulative Inhalte.
6. Regionaler Quellenwechsel möglich (DE/EN).

---

## 8. Kurzfassung

Die Pipeline über OpenRouter ist technisch machbar und auf institutionellem Niveau umsetzbar. Rollen sind generisch und adaptiv. Stil wird über Prompt und zweiten Pass kontrolliert. Voice-Agent-Logik aus gods-eye-view ist konzeptuell auf das Dashboard übertragbar. Rechtliche Kennzeichnung und legale Quellen sind Pflicht.
