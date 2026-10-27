"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/app/EmptyState";
import { FormField } from "@/components/app/FormField";
import { NumberFr } from "@/components/app/NumberFr";
import { SelectField } from "@/components/app/SelectField";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ImportResult } from "@/server/engine/client";

type Issue = ImportResult["issues"][number];
type Severity = Issue["severity"];

/** Au-delà, l'affichage est plafonné ; la liste complète reste enregistrée avec l'import. */
export const MAX_DISPLAYED_ISSUES = 500;

const ALL = "all";
const SEVERITY_OPTIONS = [
  { value: ALL, label: "Toutes" },
  { value: "error", label: "Erreurs" },
  { value: "warning", label: "Avertissements" },
  { value: "info", label: "Infos" },
];
const SEVERITY_LABEL: Record<Severity, string> = {
  error: "Erreur",
  warning: "Avertissement",
  info: "Info",
};

function SeverityBadge({ severity }: { severity: Severity }) {
  if (severity === "error") return <Badge variant="destructive">{SEVERITY_LABEL.error}</Badge>;
  if (severity === "warning") {
    return <Badge className="bg-warning text-warning-foreground">{SEVERITY_LABEL.warning}</Badge>;
  }
  return <Badge variant="secondary">{SEVERITY_LABEL.info}</Badge>;
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** « n erreurs, n avertissements, n informations » (singulier pour 0 et 1). */
export function countsSummary(counts: Record<Severity, number>): string {
  return [
    plural(counts.error, "erreur", "erreurs"),
    plural(counts.warning, "avertissement", "avertissements"),
    plural(counts.info, "information", "informations"),
  ].join(", ");
}

/** Issues d'un contrôle ou d'un import enregistré, filtrables par gravité et par code (lecture seule). */
export function IssuesTable({ issues }: { issues: readonly Issue[] }) {
  const [severity, setSeverity] = useState(ALL);
  const [code, setCode] = useState(ALL);

  const counts = useMemo(() => {
    const c: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
    for (const i of issues) c[i.severity] += 1;
    return c;
  }, [issues]);
  const codeOptions = useMemo(
    () => [
      { value: ALL, label: "Tous" },
      ...[...new Set(issues.map((i) => i.code))].sort().map((c) => ({ value: c, label: c })),
    ],
    [issues],
  );

  const filtered = issues.filter(
    (i) => (severity === ALL || i.severity === severity) && (code === ALL || i.code === code),
  );
  const shown = filtered.slice(0, MAX_DISPLAYED_ISSUES);

  if (issues.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium">{countsSummary(counts)}</p>
        <EmptyState title="Aucun problème signalé." />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{countsSummary(counts)}</p>
      <div className="flex flex-wrap gap-4">
        <div className="w-48">
          <FormField id="issues-severity" label="Gravité">
            <SelectField
              id="issues-severity"
              name="severity"
              options={SEVERITY_OPTIONS}
              value={severity}
              onValueChange={setSeverity}
              required={false}
            />
          </FormField>
        </div>
        <div className="w-64">
          <FormField id="issues-code" label="Code">
            <SelectField
              id="issues-code"
              name="code"
              options={codeOptions}
              value={code}
              onValueChange={setCode}
              required={false}
            />
          </FormField>
        </div>
      </div>
      {filtered.length > MAX_DISPLAYED_ISSUES ? (
        <p className="text-sm text-muted-foreground">
          {MAX_DISPLAYED_ISSUES} premiers problèmes affichés
        </p>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Gravité</TableHead>
            <TableHead>Code</TableHead>
            <TableHead className="text-right">Ligne</TableHead>
            <TableHead>Colonne</TableHead>
            <TableHead>Champ</TableHead>
            <TableHead>Message</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((i, index) => (
            <TableRow key={index}>
              <TableCell>
                <SeverityBadge severity={i.severity} />
              </TableCell>
              <TableCell>{i.code}</TableCell>
              <TableCell className="text-right">
                <NumberFr value={i.row} />
              </TableCell>
              <TableCell>{i.column ?? "—"}</TableCell>
              <TableCell>{i.field ?? "—"}</TableCell>
              <TableCell className="break-words whitespace-normal">{i.message}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
