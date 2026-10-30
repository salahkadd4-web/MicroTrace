import type { SummaryResponse } from "@/server/engine/client";

type Stat = SummaryResponse["stats"][number];
type Sample = SummaryResponse["samples"][number];
type Frequency = SummaryResponse["frequencies"][number];

export type ResultGroup = {
  key: string;
  method: string;
  matrix: string;
  matrixDetail: string;
  kind: string;
  basis: string;
  unit: string;
  stats: Stat[];
  samples: Sample[];
};

export type FrequencyGroup = {
  key: string;
  matrix: string;
  matrixDetail: string;
  rows: Frequency[];
};

type GroupKeyed = Pick<
  Stat,
  "method" | "matrix" | "matrix_detail" | "kind" | "basis" | "canonical_unit"
>;

const groupKey = (g: GroupKeyed) =>
  JSON.stringify([g.method, g.matrix, g.matrix_detail, g.kind, g.basis, g.canonical_unit]);

/**
 * Regroupe sans rien calculer : un groupe par (méthode, matrice, détail, kind, basis, unité)
 * tel que le moteur le renvoie, dans l'ordre d'apparition. Les groupes ne sont jamais fusionnés.
 */
export function groupResults(summary: SummaryResponse): ResultGroup[] {
  const groups = new Map<string, ResultGroup>();
  const ensure = (g: GroupKeyed) => {
    const key = groupKey(g);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        method: g.method,
        matrix: g.matrix,
        matrixDetail: g.matrix_detail,
        kind: g.kind,
        basis: g.basis,
        unit: g.canonical_unit,
        stats: [],
        samples: [],
      };
      groups.set(key, group);
    }
    return group;
  };
  for (const s of summary.stats) ensure(s).stats.push(s);
  for (const s of summary.samples) ensure(s).samples.push(s);
  return [...groups.values()];
}

/** Fréquences regroupées par (matrice, détail de matrice), dans l'ordre du moteur. */
export function groupFrequencies(summary: SummaryResponse): FrequencyGroup[] {
  const groups = new Map<string, FrequencyGroup>();
  for (const f of summary.frequencies) {
    const key = JSON.stringify([f.matrix, f.matrix_detail]);
    let group = groups.get(key);
    if (!group) {
      group = { key, matrix: f.matrix, matrixDetail: f.matrix_detail, rows: [] };
      groups.set(key, group);
    }
    group.rows.push(f);
  }
  return [...groups.values()];
}
