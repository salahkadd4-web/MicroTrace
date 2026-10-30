// Mesure la taille JSON des requêtes /summary et /report au plafond de C3
// (100 000 mesures actives). Données synthétiques, aucune base. Usage :
//   node scripts/measure-request-size.mjs
const N = Number(process.env.N ?? 50_000);
const LIMIT = 75 * 1024 * 1024;
const record = (i) => ({
  sample_id: `DONOR-${String(i % 5000).padStart(5, "0")}`,
  aliquot: "A",
  record_type: "sample",
  matrix: "whole_blood",
  matrix_detail: process.env.LEAN ? "EDTA" : "EDTA plasma, tube hépariné",
  polymer: ["PET", "PE", "PS", "PVC", "PP", "PMMA"][i % 6],
  polymer_raw: process.env.LEAN ? "pet" : "polyethylene terephthalate",
  method: "Py-GC/MS",
  technique: "py_gc_ms",
  reported_value: "12.3456",
  value: 12.3456 + i / 1000,
  unit: "ug/mL",
  canonical_value: 12.3456 + i / 1000,
  canonical_unit: "ug/mL",
  status: "quantified",
  lod: 0.1,
  loq: 0.3,
  canonical_lod: 0.1,
  canonical_loq: 0.3,
  identification_status: "confirmed",
  size_min_um: 1,
  size_max_um: 5,
  analysis_date: "2024-01-02",
  batch: "BATCH-2024-01",
  lab: process.env.LEAN ? "L" : "Laboratoire de référence",
  comment: process.env.LEAN ? "" : "commentaire libre de longueur moyenne",
  source_row: i + 2,
  source_column: "PET (ug/mL)",
});
const mb = (b) => (b / 1024 / 1024).toFixed(1);
const size = (o) => Buffer.byteLength(JSON.stringify(o));

const context = {
  data_nature: "laboratory",
  methods: [{ name: "Py-GC/MS", technique: "py_gc_ms" }],
  limits: [],
  blank_corrected: "unknown",
};
const summaryReq = { records: Array.from({ length: N }, (_, i) => record(i)) };
const s = size(summaryReq);

// Pire cas pour /report : 90 000 mesures + 10 000 contrôles qualité (total 100 000, plafond de
// l'étude), une issue d'information par ligne (I_PS_AS_SUM), répartie sur 2 imports.
const nQc = N / 10;
const records = summaryReq.records.slice(0, N - nQc);
const qc_records = summaryReq.records.slice(N - nQc).map((r) => ({ ...r, record_type: "procedural_blank" }));
const issues = (from, to) =>
  Array.from({ length: to - from }, (_, k) => ({
    code: "I_PS_AS_SUM",
    severity: "info",
    message: "Le polystyrène (PS) est rapporté comme somme des pics du styrène.",
    row: from + k + 2,
    column: "PS (ug/mL)",
    field: null,
  }));
const file = (n) => ({ name: `fichier-${n}.xlsx`, sha256: "a".repeat(64) });
const reportReq = {
  study: { title: "Étude au plafond" },
  imports: [
    { file: file(1), rules_version: "r1", date: "2024-01-01T00:00:00Z", author: "Alice", issues: issues(0, N / 2) },
    { file: file(2), rules_version: "r1", date: "2024-01-02T00:00:00Z", author: "Alice", issues: issues(N / 2, N) },
  ],
  records,
  qc_records,
  context,
};
const r = size(reportReq);
console.log(`summary : ${s} octets (${mb(s)} Mo) pour ${N} mesures`);
console.log(`report  : ${r} octets (${mb(r)} Mo) pour ${N - nQc} mesures + ${nQc} contrôles + ${N} issues`);
console.log(`limite moteur ~ ${mb(LIMIT)} Mo ; seuil d'alerte 90 % = ${mb(LIMIT * 0.9)} Mo`);
const worst = Math.max(s, r);
console.log(worst > LIMIT * 0.9 ? "ALERTE : au-dessus de 90 % de la limite" : "OK : sous 90 % de la limite");
