/**
 * „Aktuelle Sektion“ für den Chat (Fix: blieb beim Scrollen auf Sektion 1 hängen).
 *
 * Die Dashboards scrollen im <main>-Container (Seite ist h-screen/overflow-hidden). Je nach Layout,
 * Browser oder Test (window.scrollTo) kann aber auch das Dokument scrollen. Dann wandert die
 * Container-Oberkante mit nach oben (negativ), und „erste Sektion, deren Unterkante unter der
 * Container-Oberkante liegt“ ist immer Sektion 1. Referenzlinie ist deshalb die SICHTBARE Oberkante
 * des Scroll-Bereichs: max(Container-Oberkante, 0) — gilt für Main-Scroll und Window-Scroll.
 */
export const ACTIVE_SECTION_OFFSET_PX = 40;

/** Sichtbare Oberkante (Viewport-Koordinaten) des Scroll-Containers; ohne Container 0. */
export function visibleTopOf(container: Element | null | undefined): number {
  const top = container ? container.getBoundingClientRect().top : 0;
  return Math.max(Number.isFinite(top) ? top : 0, 0);
}

/** Reine Auswahl: erste Sektion (in Reihenfolge), deren Unterkante unter Referenzlinie + Offset liegt. */
export function pickActiveSectionId(
  visibleTop: number,
  sections: ReadonlyArray<{ id: number; bottom: number | null }>,
  offset = ACTIVE_SECTION_OFFSET_PX,
): number | null {
  for (const s of sections) {
    if (s.bottom == null) continue;
    if (s.bottom > visibleTop + offset) return s.id;
  }
  return null;
}
