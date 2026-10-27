"use client";

import { FormField } from "@/components/app/FormField";
import { SelectField } from "@/components/app/SelectField";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Mapping } from "@/server/engine/client";
import type { MappingField } from "./mapping-fields";

const NONE = "__none__";
const MODE_OPTIONS = [
  { value: "long", label: "Long : une ligne par mesure" },
  { value: "wide", label: "Large : une colonne par polymère" },
];

/** Copie sans les dictionnaires vides, pour ne pas envoyer de clés inutiles au moteur. */
function tidy(m: Mapping): Mapping {
  const next = { ...m };
  if (next.constants && Object.keys(next.constants).length === 0) delete next.constants;
  if (next.polymer_columns && Object.keys(next.polymer_columns).length === 0) {
    delete next.polymer_columns;
  }
  return next;
}

/**
 * Formulaire de correspondance : pour chaque champ du dictionnaire du moteur, une colonne du
 * fichier ou une constante ; colonnes de polymères en mode large ; séparation des aliquotes.
 * Contrôlé : l'assistant garde la correspondance et invalide le contrôle à chaque changement.
 */
export function MappingForm({
  fields,
  columns,
  mapping,
  onChange,
}: {
  fields: readonly MappingField[];
  columns: readonly string[];
  mapping: Mapping;
  onChange: (next: Mapping) => void;
}) {
  const known = new Set(columns);
  const allColumns = [
    ...columns,
    ...[...Object.values(mapping.field_columns), ...Object.keys(mapping.polymer_columns ?? {})].filter(
      (c) => !known.has(c),
    ),
  ];
  const columnOptions = [
    { value: NONE, label: "— Non utilisé —" },
    ...[...new Set(allColumns)].map((c) => ({ value: c, label: c })),
  ];
  const used = new Set(Object.values(mapping.field_columns));
  const polymerCandidates = [...new Set(allColumns)].filter((c) => !used.has(c));

  function setColumn(field: string, column: string) {
    const field_columns = { ...mapping.field_columns };
    const constants = { ...mapping.constants };
    if (column === NONE) {
      delete field_columns[field];
    } else {
      field_columns[field] = column;
      delete constants[field];
    }
    onChange(tidy({ ...mapping, field_columns, constants }));
  }

  function setConstant(field: string, value: string) {
    const field_columns = { ...mapping.field_columns };
    const constants = { ...mapping.constants };
    if (value === "") {
      delete constants[field];
    } else {
      constants[field] = value;
      delete field_columns[field];
    }
    onChange(tidy({ ...mapping, field_columns, constants }));
  }

  function setMode(mode: string) {
    const next = { ...mapping, mode: mode === "wide" ? ("wide" as const) : ("long" as const) };
    if (next.mode === "long") delete next.polymer_columns;
    onChange(tidy(next));
  }

  function togglePolymer(column: string, on: boolean) {
    const polymer_columns = { ...mapping.polymer_columns };
    if (on) polymer_columns[column] = column;
    else delete polymer_columns[column];
    onChange(tidy({ ...mapping, polymer_columns }));
  }

  function renamePolymer(column: string, name: string) {
    onChange({ ...mapping, polymer_columns: { ...mapping.polymer_columns, [column]: name } });
  }

  return (
    <div className="space-y-6">
      <div className="max-w-xl">
        <FormField id="mapping-mode" label="Mode du fichier">
          <SelectField
            id="mapping-mode"
            name="mode"
            options={MODE_OPTIONS}
            value={mapping.mode}
            onValueChange={setMode}
          />
        </FormField>
      </div>

      <div className="space-y-4">
        {fields.map((f) => (
          <fieldset key={f.name} className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-medium">
              {f.label} <span className="font-normal text-muted-foreground">({f.name})</span>
            </legend>
            <FormField id={`map-col-${f.name}`} label={`${f.label} : colonne`}>
              <SelectField
                id={`map-col-${f.name}`}
                name={`column-${f.name}`}
                options={columnOptions}
                value={mapping.field_columns[f.name] ?? NONE}
                onValueChange={(v) => setColumn(f.name, v)}
                required={false}
              />
            </FormField>
            <FormField id={`map-const-${f.name}`} label={`${f.label} : constante`}>
              <Input
                id={`map-const-${f.name}`}
                value={mapping.constants?.[f.name] ?? ""}
                onChange={(e) => setConstant(f.name, e.target.value)}
                autoComplete="off"
              />
            </FormField>
            {f.description ? (
              <p className="text-xs text-muted-foreground sm:col-span-2">{f.description}</p>
            ) : null}
          </fieldset>
        ))}
      </div>

      {mapping.mode === "wide" ? (
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-medium">Colonnes de polymères</legend>
          {polymerCandidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune colonne disponible.</p>
          ) : (
            polymerCandidates.map((c, i) => {
              const checked = mapping.polymer_columns?.[c] !== undefined;
              return (
                <div key={c} className="flex flex-wrap items-center gap-3">
                  <Checkbox
                    id={`poly-${i}`}
                    checked={checked}
                    onCheckedChange={(v) => togglePolymer(c, v === true)}
                  />
                  <Label htmlFor={`poly-${i}`} className="min-w-40">
                    Colonne de polymère : {c}
                  </Label>
                  {checked ? (
                    <Input
                      aria-label={`Nom du polymère pour ${c}`}
                      className="max-w-48"
                      value={mapping.polymer_columns?.[c] ?? ""}
                      onChange={(e) => renamePolymer(c, e.target.value)}
                    />
                  ) : null}
                </div>
              );
            })
          )}
        </fieldset>
      ) : null}

      <div className="flex items-center gap-2">
        <Checkbox
          id="mapping-split-aliquot"
          checked={mapping.split_aliquot_suffix}
          onCheckedChange={(v) => onChange({ ...mapping, split_aliquot_suffix: v === true })}
        />
        <Label htmlFor="mapping-split-aliquot">Séparer les aliquotes (suffixe a/b)</Label>
      </div>
    </div>
  );
}
