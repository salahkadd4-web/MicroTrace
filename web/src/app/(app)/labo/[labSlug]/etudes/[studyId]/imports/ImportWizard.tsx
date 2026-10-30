"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/app/FormError";
import { FormField } from "@/components/app/FormField";
import { formatNumberFr, NumberFr } from "@/components/app/NumberFr";
import { SelectField } from "@/components/app/SelectField";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { Mapping, TableRead } from "@/server/engine/client";
import { checkImportAction, discardStagingAction, readSheetAction, saveImportAction, suggestMappingAction, type CheckSummary } from "./actions";
import { countsSummary, IssuesTable } from "./IssuesTable";
import { MappingForm } from "./MappingForm";
import type { MappingField } from "./mapping-fields";

/** Même plafond et même texte que la route de dépôt ; le serveur reste juge. */
const MAX_BYTES = 50 * 1024 * 1024;
const TOO_BIG = "Fichier trop volumineux (50 Mo maximum).";
const UPLOAD_FAILED = "Échec de l'envoi du fichier.";
const PII_REFUSED = "Import refusé : le fichier contient des données personnelles.";
const GONE = "Dépôt introuvable ou expiré.";
const PREVIEW_ROWS = 20;

const STEPS = ["1. Dépôt", "2. Correspondance", "3. Contrôle", "4. Enregistrement"] as const;
type Step = 1 | 2 | 3 | 4;

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${formatNumberFr(bytes / 1024, 1)} Ko`;
  return `${formatNumberFr(bytes / (1024 * 1024), 1)} Mo`;
}

function previewCells(row: TableRead["preview"][number] | string[], columns: string[]): string[] {
  return Array.isArray(row) ? row : columns.map((c) => row[c] ?? "");
}

export function ImportWizard({
  labSlug,
  studyId,
  fields,
}: {
  labSlug: string;
  studyId: string;
  fields: readonly MappingField[];
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [table, setTable] = useState<TableRead | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [check, setCheck] = useState<CheckSummary | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [success, setSuccess] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sheetFailed, setSheetFailed] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const savingRef = useRef(false);

  function reset(discard = false) {
    // Le dépôt serveur est effacé au mieux ; l'oubli est sans conséquence (purge après 24 h).
    if (discard && token) void discardStagingAction(labSlug, studyId, token).catch(() => {});
    setInputKey((k) => k + 1); // remonte le champ fichier : sa valeur est vidée
    setStep(1);
    setFile(null);
    setToken(null);
    setTable(null);
    setSheet(null);
    setMapping(null);
    setCheck(null);
    setAccepted(false);
    setSheetFailed(false);
  }

  /** Dépôt disparu : retour à la zone de dépôt avec le message du serveur. */
  function fail(message: string): boolean {
    if (message === GONE) {
      reset();
      setError(GONE);
      return true;
    }
    setError(message);
    return false;
  }

  function onFileChange(selected: File | null) {
    setSuccess(false);
    setFile(selected);
    setError(selected && selected.size > MAX_BYTES ? TOO_BIG : undefined);
  }

  async function suggest(forToken: string, forSheet: string | null) {
    setSheetFailed(false);
    setError(undefined);
    setSuggesting(true);
    try {
      const res = await suggestMappingAction(labSlug, studyId, forToken, forSheet);
      if (res.error !== undefined) {
        if (!fail(res.error)) setSheetFailed(true);
      } else {
        setMapping(res.data);
      }
    } finally {
      setSuggesting(false);
    }
  }

  async function upload() {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError(TOO_BIG);
      return;
    }
    setError(undefined);
    setSuccess(false);
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      let res: Response;
      try {
        res = await fetch(`/labo/${labSlug}/etudes/${studyId}/imports/upload`, { method: "POST", body });
      } catch {
        setError(UPLOAD_FAILED);
        return;
      }
      const json = (await res.json().catch(() => null)) as
        | { token?: string; table?: TableRead; error?: string }
        | null;
      if (!res.ok || !json?.token || !json.table) {
        setError(json?.error ?? UPLOAD_FAILED);
        return;
      }
      setToken(json.token);
      setTable(json.table);
      setSheet(json.table.sheet);
      setMapping(null);
      setCheck(null);
      setAccepted(false);
      await suggest(json.token, json.table.sheet);
    } finally {
      setUploading(false);
    }
  }

  /** Relit la feuille dans le dépôt (colonnes, aperçu) puis suggère sa correspondance. */
  async function loadSheet(forToken: string, next: string) {
    setSheet(next);
    setMapping(null);
    setCheck(null);
    setAccepted(false);
    setError(undefined);
    setSheetFailed(false);
    setSuggesting(true);
    try {
      const res = await readSheetAction(labSlug, studyId, forToken, next);
      if (res.error !== undefined) {
        if (!fail(res.error)) setSheetFailed(true);
        return;
      }
      setTable((t) => (t ? { ...t, ...res.data } : t));
      const sug = await suggestMappingAction(labSlug, studyId, forToken, next);
      if (sug.error !== undefined) {
        if (!fail(sug.error)) setSheetFailed(true);
      } else {
        setMapping(sug.data);
      }
    } finally {
      setSuggesting(false);
    }
  }

  async function onSheetChange(next: string) {
    if (token) await loadSheet(token, next);
  }

  function onMappingChange(next: Mapping) {
    setMapping(next);
    setCheck(null);
    setAccepted(false);
  }

  async function runCheck() {
    if (!token || !mapping) return;
    setError(undefined);
    setChecking(true);
    try {
      const res = await checkImportAction(labSlug, studyId, { token, sheet, mapping });
      if (res.error !== undefined) {
        fail(res.error);
        return;
      }
      if (res.data.issues.some((i) => i.code.startsWith("E_PII_"))) {
        // Le serveur a effacé le dépôt : retour à la zone de dépôt (rien à discarder).
        reset();
        setError(PII_REFUSED);
        return;
      }
      setCheck(res.data);
      setAccepted(false);
    } finally {
      setChecking(false);
    }
  }

  async function save() {
    if (!token || !mapping || !check || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(undefined);
    try {
      const res = await saveImportAction(labSlug, studyId, {
        token,
        sheet,
        mapping,
        acceptWarnings: accepted,
      });
      if (res.error !== undefined) {
        fail(res.error);
        return;
      }
      reset();
      setSuccess(true);
      router.refresh();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const hasErrors = (check?.counts.error ?? 0) > 0;
  const hasWarnings = (check?.counts.warning ?? 0) > 0;
  const canGoNext =
    (step === 1 && token !== null && mapping !== null && !suggesting) ||
    step === 2 ||
    (step === 3 && check !== null && !hasErrors);
  const canSave = check !== null && !hasErrors && (!hasWarnings || accepted) && !saving;
  const busy = uploading || suggesting || checking || saving;

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Étapes de l'import">
        {STEPS.map((label, index) => (
          <li
            key={label}
            aria-current={step === index + 1 ? "step" : undefined}
            className={cn(
              "rounded-md border px-3 py-1",
              step === index + 1
                ? "border-primary font-medium text-foreground"
                : "text-muted-foreground",
            )}
          >
            {label}
          </li>
        ))}
      </ol>

      {success ? (
        <Alert role="status">
          <AlertDescription>Import enregistré.</AlertDescription>
        </Alert>
      ) : null}
      <FormError message={error} />

      {step === 1 ? (
        <div className="space-y-4">
          <div className="max-w-xl space-y-2">
            <Label htmlFor="import-file">Fichier à importer</Label>
            <Input
              key={inputKey}
              id="import-file"
              type="file"
              accept=".csv,.xlsx"
              disabled={uploading || token !== null}
              onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            />
          </div>
          {token === null ? (
            <Button
              type="button"
              onClick={upload}
              disabled={!file || file.size > MAX_BYTES || uploading}
            >
              {uploading ? "Envoi en cours…" : "Envoyer le fichier"}
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => reset(true)} disabled={busy}>
              Changer de fichier
            </Button>
          )}

          {table ? (
            <div className="space-y-3">
              <p className="text-sm">
                <span className="font-medium">{table.filename}</span>
                {" · "}
                {formatSize(table.size)}
                {" · "}
                <NumberFr value={table.n_rows} /> lignes
              </p>
              {table.sheets.length > 1 ? (
                <div className="max-w-xs">
                  <FormField id="import-sheet" label="Feuille">
                    <SelectField
                      id="import-sheet"
                      name="sheet"
                      options={table.sheets.map((s) => ({ value: s, label: s }))}
                      value={sheet ?? undefined}
                      onValueChange={onSheetChange}
                    />
                  </FormField>
                </div>
              ) : null}
              <p className="text-sm text-muted-foreground">
                Aperçu des {PREVIEW_ROWS} premières lignes
                {table.sheet ? ` de la feuille « ${table.sheet} »` : ""}.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    {table.columns.map((c) => (
                      <TableHead key={c}>{c}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {table.preview.slice(0, PREVIEW_ROWS).map((row, r) => (
                    <TableRow key={r}>
                      {previewCells(row, table.columns).map((cell, c) => (
                        <TableCell key={c}>{cell}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {sheetFailed && token ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => (sheet ? loadSheet(token, sheet) : suggest(token, null))}
                  disabled={suggesting}
                >
                  Réessayer
                </Button>
              ) : null}
              {suggesting ? (
                <p className="text-sm text-muted-foreground">Recherche de la correspondance…</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 2 && table && mapping ? (
        <MappingForm fields={fields} columns={table.columns} mapping={mapping} onChange={onMappingChange} />
      ) : null}

      {step === 3 ? (
        <div className="space-y-4">
          <Button type="button" onClick={runCheck} disabled={checking || !mapping}>
            {checking ? "Contrôle en cours…" : check ? "Relancer le contrôle" : "Lancer le contrôle"}
          </Button>
          <p className="text-sm text-muted-foreground">
            Le contrôle n&apos;enregistre rien : il liste les problèmes du fichier avec la correspondance choisie.
          </p>
          {check ? (
            <div className="space-y-3">
              <p className="text-sm">
                <NumberFr value={check.n_rows} /> lignes lues.
              </p>
              <IssuesTable issues={check.issues} />
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 4 && check ? (
        <div className="space-y-4">
          <p className="text-sm">
            <NumberFr value={check.n_rows} /> lignes lues : {countsSummary(check.counts)}.
          </p>
          {hasWarnings ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id="accept-warnings"
                checked={accepted}
                onCheckedChange={(v) => setAccepted(v === true)}
              />
              <Label htmlFor="accept-warnings">J&apos;ai lu les avertissements et je les accepte</Label>
            </div>
          ) : null}
          <Button type="button" onClick={save} disabled={!canSave}>
            {saving ? "Enregistrement…" : "Enregistrer l'import"}
          </Button>
        </div>
      ) : null}

      <div className="flex gap-2">
        {step > 1 ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setStep((s) => (s - 1) as Step)}
          >
            Précédent
          </Button>
        ) : null}
        {step < 4 ? (
          <Button
            type="button"
            disabled={!canGoNext || busy}
            onClick={() => setStep((s) => (s + 1) as Step)}
          >
            Suivant
          </Button>
        ) : null}
      </div>
    </div>
  );
}
