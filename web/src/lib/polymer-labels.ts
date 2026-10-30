/**
 * Libellés d'affichage des codes de polymères renvoyés par le moteur. Ce ne sont pas des règles :
 * la ligne « ANY » et la somme « PS_SUM » sont calculées par le moteur.
 */
const POLYMER_LABELS: Record<string, string> = {
  PS_SUM: "PS (somme)",
  ANY: "Au moins un polymère",
};

/** Libellé français d'un code de polymère ; un autre code (PET, PE, PP, PMMA…) est montré tel quel. */
export function polymerLabel(code: string): string {
  return Object.hasOwn(POLYMER_LABELS, code) ? POLYMER_LABELS[code] : code;
}
