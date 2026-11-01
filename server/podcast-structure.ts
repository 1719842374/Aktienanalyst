/**
 * Öffentliche Episodenseiten, gelesen am 01.11.2026.
 * Titel und Beschreibung stehen so auf der Seite. Die Prinzipien darunter
 * sind die Ableitung (Aufbau, Treiber, Einordnung). Sie enthalten keine
 * Behauptung, die nicht aus Titel oder Beschreibung folgt.
 *
 * All-In, https://open.spotify.com/episode/53mAntPRAPyGp6LI5wFiY5
 * JSON-LD name + description (Kapitel, keine zusätzliche Prosa):
 * (0:00) Bestie Intros
 * (3:22) Anthropic S-1 Breakdown: Greatest Business Ever?
 * (32:47) AI's Biggest Problem and Anthropic's Doomer Showdown
 * (1:01:57) Google Sheds $500B Market Cap in Worst Day Ever: What Went Wrong?
 * (1:14:17) Final Midterms Predictions and Scenarios
 * Daraus: Intro, eine Entwicklung als Frage, ein Problemblock, eine
 * Markteinordnung, ein Schluss.
 *
 * Exchanges, https://open.spotify.com/episode/12iMZVDdBml2Q1OMhnBI5H
 * Titel nennt Implementation, Accountability and Jobs.
 * Beschreibung: „rules of the road“, Innovation und Sicherheit sind kein
 * Entweder-oder, Optimismus zum Arbeitsmarkt.
 * Key takeaways auf der Seite:
 * - dritte Kontrollebene bei den einsetzenden Firmen
 * - Lernen aus früheren Innovationen und aus Risiko- und Kontrollprozessen
 * - junge Wissensarbeiter sollen KI als Werkzeug nutzen
 * Datum der Aufnahme auf der Seite: October 26, 2026.
 * Die Seite enthält einen Hinweis, dass das Material keine Anlageberatung ist.
 * Daraus: These am Anfang, getrennte Takeaways, Einordnung, Kennzeichnung.
 */

export interface PodcastStructureSource {
  url: string;
  show: string;
  title: string;
  publishedOnPage: string;
  description: string;
}

export const PODCAST_STRUCTURE: readonly PodcastStructureSource[] = [
  {
    url: "https://open.spotify.com/episode/53mAntPRAPyGp6LI5wFiY5",
    show: "All-In with Chamath, Jason, Sacks & Friedberg",
    title: "Anthropic S-1 Shocker, Greatest Business Ever? Google’s $500B Wipeout, Midterm Predictions",
    publishedOnPage: "Oct 30",
    description: "(0:00) Bestie Intros (3:22) Anthropic S-1 Breakdown: Greatest Business Ever? (32:47) AI's Biggest Problem and Anthropic's Doomer Showdown (1:01:57) Google Sheds $500B Market Cap in Worst Day Ever: What Went Wrong? (1:14:17) Final Midterms Predictions and Scenarios",
  },
  {
    url: "https://open.spotify.com/episode/12iMZVDdBml2Q1OMhnBI5H",
    show: "Exchanges",
    title: "Goldman Sachs Chairman and CEO David Solomon on AI: Implementation, Accountability, and Jobs",
    publishedOnPage: "Oct 27",
    description: "With the right “rules of the road,” advancing AI doesn’t have to be a choice between innovation and safety, says David Solomon, chairman and CEO of Goldman Sachs. He also explains why he’s optimistic about AI’s impact on the job market in this episode of the Exchanges podcast. Key takeaways: The third layer of AI control: In addition to governments and tech providers, responsibility for AI also lies with the companies deploying it. Learning from the past: Previous scientific and technological innovations can provide a model for implementing AI—as can the risk and control processes of financial firms. Advice for young knowledge workers: Solomon advises young professionals to adapt to AI and treat it as a key tool to enhance their work. Date of recording: October 26, 2026. The page says the material does not constitute investment, legal, or tax advice.",
  },
];

/** Abgeleitete Gliederung. Der Prompt übernimmt diese Zeilen, nicht die Episodentitel. */
export function podcastStructurePrinciples(): string[] {
  return [
    "Intro: Thema und warum es jetzt relevant ist",
    "Eine Entwicklung als Frage oder These",
    "Getrennte Takeaways, jeder mit Mechanismus und Quelle",
    "Problem oder Dissens",
    "Einordnung, was das für den Markt bedeutet",
    "Kennzeichnung: keine Anlageberatung, KI-generiert im Research-Stil",
  ];
}

export const PODCAST_DISCLAIMER = "Dies ist keine Anlageberatung. KI-generiert im Research-Stil.";
