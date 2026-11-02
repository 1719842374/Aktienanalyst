# WORK-Inventur 2026-11-02

Soll gegen `main` `fc933a5e5bee5691a85dac5e2402c2bacc520b70` (`fix(researcher): Gold-Klick, Kartenrand und Sektor-Kaltstart (#412)`).

Gelesen: jede `WORK_*.md` im Repo-Root und unter `docs/`. Nicht in der Tabelle, weil andere Agents sie bauen: `WORK_RECESSION_*` (drei Dateien im Root). `BUFFETT_ASIA`, `CAPEX_*` und `GOLD_MINER` liegen nicht als `WORK_*.md` in Root oder `docs/` (die zugehörigen Specs heißen `Offen_WORK_…`).

Draft-PRs zählen nicht als Ist. Ein Punkt ist **erledigt**, wenn der Soll-Kern auf diesem Tip im Code liegt. **teilweise**, wenn ein Teil der Kette da ist und ein benannter Rest fehlt. **offen**, wenn der Soll-Kern fehlt. **braucht Philip = ja**, wenn der Rest Score, Rating, `server/analyze-route.ts`, Env, Domain, Deploy, Supabase, Render-Settings, Mail oder eine neue kostenpflichtige Quelle wäre, oder wenn die Spec selbst eine Freigabe verlangt. HOLD und nicht dupliziert: #299, #372, #383. Peer-Varianten C/E sind nicht als eigene Spec-Abschnitte benannt; A/B sind auf main (`2c95501`).

Keine Spec wurde umbenannt. `fertig_` / `Fertig_` bleibt.

## Tabelle

| Datei | Status | Beleg auf main | braucht Philip |
|---|---|---|---|
| `WORK_BUFFETT_ADAPTIVE_SOLUTION.md` | offen | Kein Modul für sektoradjustierte Buffett-Gewichte. #383 (HOLD) ist ein anderes Objekt (Rezessions-Makro). | ja — Score |
| `WORK_BUFFETT_ADJUST_IMPL.md` | offen | Vorschlag (ETF-Holdings, β aus Historie), nicht verdrahtet. | ja — Score, Buffett-Formel |
| `WORK_BUFFETT_OVERLAYS.md` | offen | Overlays wären auf dem Aktien-Chart. Buffett bleibt nur in `#/recession` (`RecessionDashboard.tsx`, `BuffettRatioPanel`). | ja — würde den Indikator aus `#/recession` herausziehen |
| `WORK_BUFFETT_WEIGHT_DISTORTION.md` | offen | Die Datei beschreibt die feste Zone >200 % und ×2. Eine Änderung wäre der Score. | ja — Score |
| `WORK_BUSINESS_MODEL_AI_SUPPLEMENT.md` | offen | Keine Unterposten unter FMP-Segmenten. Draft #394 deckt die Anzeige, nicht gemergt, hier nicht dupliziert. | nein für die markierte Schätzung; ja, sobald sie in den Score geht |
| `WORK_CHAT_PODCAST_MCP.md` | teilweise | §1 Verlauf: `shared/chat-history.ts`, `ChatWidget.tsx` (`9d0ffb4`), New/Liste/Löschen, Session-Cache. §2 Transkript: `PodcastTranscript.tsx` (`9d0ffb4`) Drop-Cap, Serif, Badge; Player-Zeile `n/a — keine Audiodatei im lokalen Cache`. §3 FMP-MCP fehlt. | ja nur für §3 (kostenpflichtige Quelle, API-Key) und für TTS |
| `WORK_CHAT_UPLOAD_CONNECTOR.md` | offen | Kein Upload, kein Voice, kein `/api/scoring/:symbol`. | ja — Env, Whisper/Vision, Scoring-API |
| `WORK_DASHBOARD_FEATURES_2026-10.md` | teilweise | Chat auf Aktien, BTC, Gold, Rezession (`ChatWidget`, `9d0ffb4`). Event hinzufügen: `CatalystsSection.tsx` → `POST /api/catalyst-event` (`3f5a5a7`). Peer-Kurs im Chart: `TechnicalChart.tsx` (`7c35b15`). Jahres-Tabelle, Sankey, Earnings-Marker, Custom-Screener fehlen auf main (Drafts #394, #386, #392). Szenario-Override von DCF/Gates/Ampel fehlt. | ja für Override und für alles, was den Score neu rechnet. nein für die reinen Anzeige-Drafts, die schon offen sind |
| `WORK_EARNINGS_YIELD_ROIC_PLOT.md` | erledigt | `shared/earnings-yield-roic.ts` (`dd60c4a`), Toggles in `TechnicalChart.tsx` (`7c35b15`): Earnings Yield, ROIC 5Y, ein Peer als Kurs oder ROIC. | nein |
| `WORK_EARNINGS_YIELD_ROIC_IMPLEMENTATION.md` | erledigt | Dieselbe Kette. Der Satz „Nicht vorhanden“ in der Spec (Stand 26.10.) ist überholt. | nein |
| `WORK_GURUFOCUS_METRICS_ASSESSMENT.md` | offen | Die Datei ist die Einschätzung. WACC-vs-ROIC, Piotroski und Years of Profitability sind nicht auf main. Draft #394 hat ein WACC/ROIC-Badge, nicht gemergt. | ja — Ampel wäre Rating; die Historie wäre eine zusätzliche FMP-Serie |
| `WORK_HYBRID_CLASSIFICATION.md` | teilweise | Anteile im Thesis-Panel: `ThesisStrengthPanel.tsx` (`9d0ffb4`) plus `dominantThesisClass` in `shared/chat-context.ts`. Sektion 2 zeigt weiter ein Lynch-Label. „Sekundär bei >20 %“ widerspricht `WORK_HYBRID_XPENG.md` („keine feste Schwelle“). | ja für die Schwelle 20 % gegen „keine Schwelle“. Die Anzeige der Anteile selbst braucht keine Freigabe |
| `WORK_HYBRID_XPENG.md` | erledigt | Die Datei beantwortet die Frage: übertragbar, wenn die Anteile aus den Daten kommen. Das Panel rechnet `styleConfidences` pro Ticker, ohne XPeng-Hardcoding. | nein |
| `WORK_HYPECYCLE_EMAIL_SUPABASE.md` | offen | Kein Hype-Proxy und kein Mailversand auf main. `shared/attraktiv-notify.ts` hält den Versand aus. Draft #390 ist der FMP-Proxy ohne Trends, nicht gemergt. | ja — Mail, Supabase, Env |
| `WORK_IMPLEMENTIERUNG_OFFEN.md` | teilweise | Index, kein Feature. Ampel-Banner endet vor diesem Tip. | nein |
| `WORK_IST_VS_SOLL.md` | teilweise | Index, kein Feature. Kopf nennt Tip `a0979593`, nicht `fc933a5`. | nein |
| `WORK_KI_CHAT_BIG_PICTURE.md` | erledigt | `shared/chat-earnings.ts` und Prompt in `server/chat-route.ts` (`9d0ffb4`): Call, fünf Schlagzeilen (`CHAT_NEWS_HEADLINE_COUNT`), kohärente Zusammenfassung. Widget zeigt den Call. | nein |
| `WORK_KI_CHAT_ERROR.md` | erledigt | Kein festes 400-Zeichen-Limit mehr. `CHAT_LIMITS` hängt am Budget 36 000 (`shared/chat-context.ts`, `9d0ffb4`). Test `script/test-chat-fact-limit.ts`. | nein |
| `WORK_KI_CHAT_LIMIT_ALL.md` | erledigt | Dieselbe Budget-Verteilung für Wachstumsthese, Rationale und Notes. | nein |
| `WORK_KI_CHAT_SCHEMA.md` | teilweise | Blöcke und dominante Klasse sind im Prompt (`9d0ffb4`). PESTEL nur bei „Hoch“. §3: KI-Antworten der übrigen Sektionen sind nicht belegt; im Kontext steht die Catalyst-`kiAntwort`. Die Spec sagt das selbst. | nein für die Anzeige bereits erzeugter Texte. ja, wenn dafür ein neuer LLM-Lauf oder Env nötig ist |
| `WORK_KI_CHAT_SCHEMA_UPDATE.md` | erledigt | `dominantThesisClass` ohne Wachstumsschwelle (`shared/chat-context.ts`). | nein |
| `WORK_KOMBINATIONSKURS_AMPEL.md` | teilweise | Portfolio-Kombinationskurs: `client/src/lib/comboBands.ts` (`8dfabf5`), gefärbt mit der bestehenden TA-Ampel, nicht mit `getAmpelStatus` (DCF > 10, RSL > 95). Die Aktien-Sektion 12 hat diese Segmente auf main nicht. Draft #386 hat `shared/ta-ampel.ts`, nicht gemergt. | nein für die reine TA-Färbung. ja, wenn die Spec-Schwellen 10 und 95 als neues Rating eingeführt werden |
| `WORK_KOSTENUEBERSICHT.md` | erledigt | Die Datei ist die Übersicht (Stand 31.10.). Kein Code-Soll. | nein. Env, Domain, Render und Mail daraus nicht angefasst |
| `WORK_NVO_TECHNICAL_OVERRIDE.md` | teilweise | `shared/bias-fixes.ts` (`8bb4967`), Test `script/test-tech-moat-override.ts`. Die Spec bleibt offen, bis Philip die Vorher/Nachher-Tabelle freigibt. `analyze-route.ts` und `scoring-gates.ts` wurden dafür nicht geändert. | ja — die Datei verlangt die Freigabe |
| `WORK_PEER_RELATIVE_VALUATION_BUGS.md` | teilweise | KI-Zeilen stehen auf main in der Seitenliste (`PeerComparison.tsx`, `2c95501`; Test verlangt das ausdrücklich). Overrides und klare Ablehnung existieren. Autocomplete fehlt (Draft #311). Nachladen über `analyze-route.ts` ist Draft #353. | ja für „≥ 3 KI-Peers und RELATIVE_GROWTH score-wirksam“ und für `analyze-route.ts`. nein für die Anzeige in derselben Tabelle |
| `WORK_PEER_SELECTION.md` | teilweise | Overrides überleben Reload (`client/src/lib/peerOverrideLimits.ts`, `33c1419`; Deckel 8). Filter-Tabs ±50 % Market Cap, ±30 % KGV, Industrie (`peerViewFilter.ts`, `2c95501`). GICS Sub-Industry: `n/a – keine GICS-Sub-Industry-Quelle`. | nein. Eine neue GICS-Quelle wäre ja |
| `WORK_PEER_SELECTION_DETAILED.md` | teilweise | Dieselbe Kette wie die kurze Peer-Spec. Varianten A/B sind Ansicht, kein Score (`2c95501`). | nein |
| `WORK_PODCAST_PIPELINE.md` | teilweise | `server/podcast-pipeline.ts` und `server/podcast-prompt.ts` (`9d0ffb4`): Ranking, Prompt, Audio-Adapter. Akzeptanz 7.1 und 7.2 (Audio durchgängig, vier Rollen im Dialog) sind nicht belegt; die Schema-Spec sagt das. | ja für OpenRouter-Audio (Env, kostenpflichtig) |
| `WORK_PODCAST_PROMPT.md` | erledigt | Prompt und Schema liegen in `server/podcast-prompt.ts` (`9d0ffb4`), inkl. Kennzeichnung als KI-generiert. | nein |
| `WORK_REALZINS_ADJUST.md` | offen | Keine φ-Adjustierung des Buffett-Indikators auf main. Draft #378 zeigt sie nur im Rezessions-Panel, nicht gemergt. | ja — Buffett-Score |
| `WORK_REMOVE_BUFFETT_STOCK.md` | erledigt | Aktien-Dashboard mountet `BuffettMacroCard` nicht. Test `script/test-buffett-stock-card.ts` (`597953d`). Rezession behält `BuffettRatioPanel`. | nein |
| `WORK_SCENARIO_CONE_STOCK.md` | erledigt | `client/src/lib/scenarioCone.ts` (`afedd63`), Toggle in `TechnicalChart.tsx`. Nur Visualisierung, kein Score. | nein |
| `WORK_SCORING_ADDITIONS_MSFT.md` | teilweise | Earnings Yield ist als Plot da (eigene Spec, erledigt). Accruals und ein Quality-Value-Score sind nicht im Score. Die Spec rät vom zusätzlichen Score ab. Draft #366 legt Ergänzungen hinter ein Flag, nicht gemergt. | ja — Score |
| `WORK_SECTION_WEIGHTING_ADAPTIVE.md` | teilweise | Tech-Moat-Deckel wie bei NVO (`8bb4967`). `valuationWeight`-Formel der Spec ist nicht umgesetzt. Die Datei bleibt offen bis zur Freigabe. | ja |
| `WORK_SECTORAL_MOAT_DAMPING.md` | offen | Dämpfung bei Golden Cross + schwachem Moat + Rivalität ist nicht auf main. | ja — Score |
| `WORK_SECTOR_PE_ATTRACTIVITY_REVERSEDCF.md` | teilweise | Attraktivität aus Perzentil und Δ-z: `shared/sector-attr-band.ts` (`2e12f36`), Panel `SectorRotationPanel.tsx`. PE-10J kommt aus ETF-Ratios, die Warnung „unvollständig (n/9)“ bleibt, wenn FMP leer ist. Reverse-DCF je Sektor (g* und Gap) fehlt. | ja für eine neue Holdings-Aggregation auf der kostenpflichtigen FMP-Quelle. Die vorhandene Ampel braucht keine Freigabe |
| `WORK_SIMPLYWALLST_LEARNINGS.md` | teilweise | Sofort: Markdown `ChatMarkdown.tsx` (`da633c5`), Badge „KI-generiert, keine Anlageberatung“ im Widget. Community-Narrative und Snowflake fehlen und sind in der Spec „später“. | nein für den Rest der Sofort-Punkte. ja für Community-Speicher (Supabase) und für ein neues Score-Visual |
| `docs/Doc_Soll_vs_Ist/WORK_EXEC_SUMMARY.md` | erledigt | Hub-Kopie, kanonisch `fertig_WORK_EXEC_SUMMARY.md`. Drei Absätze Fließtext. | nein |
| `docs/work-offen/WORK_RESEARCHER_BRIEFING_REGIONAL.md` | teilweise | Die Kopie (04.09.) sagt noch „ein Block, US-lastig“. Auf main: `server/researcher.ts` (`386fd0a`) läuft US/EU/ASIA und setzt die drei Bücher Geld, Fiskal, Handel. Ob jeder Slot live einen Wert hat, ist hier nicht gegen Prod geprüft. | nein, solange keine neue Quelle dazukommt |

## Was dieser Lauf gebaut hat

Nur die Anzeige aus `WORK_PEER_RELATIVE_VALUATION_BUGS.md` §3, ohne Score: Draft #420 (`cursor/peer-ki-same-table-dcbe`). Auf `main` bleibt der Punkt teilweise, bis der Draft gemergt ist.

Nicht gebaut, weil Drafts schon existieren und der Auftrag sie nicht duplizieren soll, soweit sie denselben Soll decken: #311 Autocomplete, #353 Peer-Nachladen (fasst `analyze-route.ts` an), #386 Chart-Ampel und Earnings-Marker, #390 Hype-Proxy, #392 Screener-Kriterien, #394 Jahrestabelle, Sankey, Segment-Schätzung.

Nicht gebaut, weil Philip: Score, Rating-Schwellen, `analyze-route.ts`, Env, Domain, Deploy, Supabase, Render, Mail, neue kostenpflichtige Quellen, Buffett außerhalb von `#/recession`, HOLD #299, #372, #383.
