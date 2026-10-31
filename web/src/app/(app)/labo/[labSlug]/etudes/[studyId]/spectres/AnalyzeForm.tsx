"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { FormError } from "@/components/app/FormError";
import { FormField } from "@/components/app/FormField";
import { SubmitButton } from "@/components/app/SubmitButton";
import { Input } from "@/components/ui/input";
import { SPECTRAL_MAX_BYTES } from "@/lib/spectral";

const TOO_BIG = "Fichier trop volumineux (2 Mo maximum).";
const NO_FILE = "Choisissez le fichier du spectre.";
const UPLOAD_FAILED = "Échec de l'envoi du fichier.";
const SELECT_CLASS =
  "h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type Technique = "raman" | "ftir_atr";

/** Dépôt d'un spectre : le serveur analyse et enregistre ; succès → page de l'analyse. */
export function AnalyzeForm({ labSlug, studyId }: { labSlug: string; studyId: string }) {
  const router = useRouter();
  const [technique, setTechnique] = useState<Technique>("raman");
  const [xUnit, setXUnit] = useState("cm-1");
  const [yUnit, setYUnit] = useState("absorbance");
  const [laser, setLaser] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    if (!file) {
      setError(NO_FILE);
      return;
    }
    if (file.size > SPECTRAL_MAX_BYTES) {
      setError(TOO_BIG);
      return;
    }
    setError(undefined);
    setPending(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("technique", technique);
      body.append("x_unit", technique === "raman" ? xUnit : "cm-1");
      body.append("y_unit", technique === "raman" ? "intensity" : yUnit);
      body.append("laser_nm", technique === "raman" ? laser.trim() : "");
      let res: Response;
      try {
        res = await fetch(`/labo/${labSlug}/etudes/${studyId}/spectres/analyser`, {
          method: "POST",
          body,
        });
      } catch {
        setError(UPLOAD_FAILED);
        return;
      }
      const json = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok || !json?.id) {
        setError(json?.error ?? UPLOAD_FAILED);
        return;
      }
      router.push(`/labo/${labSlug}/etudes/${studyId}/spectres/${json.id}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-4">
      <FormField id="spectrum-file" label="Fichier du spectre">
        <Input
          id="spectrum-file"
          type="file"
          accept=".csv,.txt,.tsv,.dat,.asc"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError(undefined);
          }}
        />
        <p className="text-xs text-muted-foreground">
          Texte à deux colonnes (axe, intensité), 2 Mo au plus.
        </p>
      </FormField>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Technique</legend>
        {(
          [
            ["raman", "Raman"],
            ["ftir_atr", "FTIR (ATR)"],
          ] as const
        ).map(([code, label]) => (
          <label key={code} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="technique"
              value={code}
              checked={technique === code}
              onChange={() => setTechnique(code)}
              className="size-4 accent-primary"
            />
            {label}
          </label>
        ))}
      </fieldset>

      {technique === "raman" ? (
        <>
          <FormField id="spectrum-x-unit" label="Unité de l'axe">
            <select
              id="spectrum-x-unit"
              value={xUnit}
              onChange={(e) => setXUnit(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="cm-1">Déplacement Raman (cm⁻¹)</option>
              <option value="nm">Longueur d&apos;onde (nm)</option>
            </select>
          </FormField>
          <FormField id="spectrum-laser" label="Longueur d'onde du laser (nm)">
            <Input
              id="spectrum-laser"
              inputMode="decimal"
              required
              value={laser}
              onChange={(e) => setLaser(e.target.value)}
              className="max-w-40"
            />
          </FormField>
        </>
      ) : (
        <FormField id="spectrum-y-unit" label="Ordonnée">
          <select
            id="spectrum-y-unit"
            value={yUnit}
            onChange={(e) => setYUnit(e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="absorbance">Absorbance</option>
            <option value="transmittance_pct">Transmittance (%)</option>
          </select>
        </FormField>
      )}

      <FormError message={error} />
      <SubmitButton pending={pending} pendingLabel="Analyse en cours…">
        Analyser le spectre
      </SubmitButton>
    </form>
  );
}
