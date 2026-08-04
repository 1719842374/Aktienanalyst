/**
 * Kelly-Kriterium — Virtuelles Portfolio (WORK_PORTFOLIO.md Kapitel D).
 *
 * Wortgetreue Übernahme des Referenz-Codes aus §D.6 der Spezifikation.
 *
 * §D.1 Zwecktrennung (WICHTIG, mehrfach betont in der Spezifikation):
 *   Kelly ist NIEMALS Ersatz für die Basket-Diversifikation aus Kapitel B.
 *   CAPM/Modus A-C liefert Gewichte über MEHRERE Titel (Summe = 1).
 *   Kelly beantwortet ausschließlich "wie groß darf EINE Position sein?" —
 *   die Kelly-f-Werte verschiedener Titel werden NICHT über die Buy-Liste
 *   aufsummiert und NICHT als Portfolio-Gewichte interpretiert.
 *
 *   Kelly-f bezieht sich immer auf das GESAMTKAPITAL K (nicht "Restcash
 *   only"), außer die UI wählt explizit einen separaten Cash-Bucket-Modus
 *   (§D.4 Checkliste).
 *
 *   Kein automatischer Full-Kelly: Half-Kelly (fraction=0.5) ist der
 *   UI-Default, siehe applyKellyPolicy(). fMax=0.25 ist ein hartes Cap.
 */

export function kellyContinuous(mu: number, sigma: number, rf: number): number {
  if (sigma <= 1e-12) return 0;
  return (mu - rf) / (sigma * sigma);
}

export function kellyDiscrete(p: number, b: number): number {
  if (b <= 0 || p <= 0 || p >= 1) return 0;
  return (p * b - (1 - p)) / b;
}

export function applyKellyPolicy(fStar: number, opts?: { fraction?: number; maxF?: number }): {
  fStar: number; fHalf: number; fCapped: number;
} {
  const fraction = opts?.fraction ?? 0.5;
  const maxF = opts?.maxF ?? 0.25;
  const fStarPos = Math.max(0, fStar);
  const fHalf = fStarPos * fraction;
  const fCapped = Math.min(fHalf, maxF);
  return { fStar: fStarPos, fHalf, fCapped };
}

export function sizeKellySingle(opts: {
  mu?: number; sigma?: number; rf?: number;
  p?: number; b?: number;
  capitalBase: number; price: number;
  method: 'continuous' | 'discrete';
}): {
  fStar: number; fHalf: number; fCapped: number;
  amount: number; sharesHint: number;
} {
  const fStar =
    opts.method === 'continuous'
      ? kellyContinuous(opts.mu!, opts.sigma!, opts.rf!)
      : kellyDiscrete(opts.p!, opts.b!);
  const { fHalf, fCapped } = applyKellyPolicy(fStar);
  const amount = fCapped * opts.capitalBase;
  return {
    fStar: Math.max(0, fStar),
    fHalf,
    fCapped,
    amount,
    sharesHint: opts.price > 0 ? amount / opts.price : 0,
  };
}
