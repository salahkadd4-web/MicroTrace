import type { components } from "./schema";

type S = components["schemas"];

/** Vrai seulement si A et B sont exactement le même type. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Compile uniquement si le tableau couvre exactement l'union générée (ni plus, ni moins). */
type Exact<Actual, Expected> = Equal<Actual, Expected> extends true ? Actual : never;

type UnitUnion = S["MeasurementRecordModel"]["unit"];
type TechniqueUnion = S["MethodSpecModel"]["technique"];
type QcKindUnion = Exclude<S["MeasurementRecordModel"]["record_type"], "sample">;

export type UnitCode = UnitUnion;
export type Technique = TechniqueUnion;
export type QcKind = QcKindUnion;

export const UNIT_CODES = [
  "ug/mL",
  "ng/mL",
  "mg/L",
  "ug/L",
  "ug/g",
  "ng/g",
  "mg/kg",
  "particles/mL",
  "particles/L",
  "particles/g",
] as const;

export const TECHNIQUES = [
  "py_gc_ms",
  "ted_gc_ms",
  "micro_ftir",
  "micro_raman",
  "other",
] as const;

export const QC_KINDS = ["procedural_blank", "field_blank", "spiked"] as const;

// Vérifications à la compilation : le tableau doit couvrir exactement l'union du moteur.
export const _unitCodesExact: Exact<(typeof UNIT_CODES)[number], UnitUnion> = UNIT_CODES[0];
export const _techniquesExact: Exact<(typeof TECHNIQUES)[number], TechniqueUnion> = TECHNIQUES[0];
export const _qcKindsExact: Exact<(typeof QC_KINDS)[number], QcKindUnion> = QC_KINDS[0];
