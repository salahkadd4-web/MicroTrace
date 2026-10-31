"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { FormError } from "@/components/app/FormError";
import { FormField } from "@/components/app/FormField";
import { SelectField } from "@/components/app/SelectField";
import { SubmitButton } from "@/components/app/SubmitButton";
import { Input } from "@/components/ui/input";
import { SPECTRAL_MAX_BYTES } from "@/lib/spectral";

const TOO_BIG = "Fichier trop volumineux (2 Mo maximum).";
const NO_FILE = "Choisissez le fichier du spectre.";
const UPLOAD_FAILED = "Échec de l'envoi du fichier.";

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
            <SelectField
              id="spectrum-x-unit"
              name="x_unit"
              value={xUnit}
              onValueChange={setXUnit}
              options={[
                { value: "cm-1", label: "Déplacement Raman (cm⁻¹)" },
                { value: "nm", label: "Longueur d'onde (nm)" },
              ]}
            />
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
          <SelectField
            id="spectrum-y-unit"
            name="y_unit"
            value={yUnit}
            onValueChange={setYUnit}
            options={[
              { value: "absorbance", label: "Absorbance" },
              { value: "transmittance_pct", label: "Transmittance (%)" },
            ]}
          />
        </FormField>
      )}

      <FormError message={error} />
      <SubmitButton pending={pending} pendingLabel="Analyse en cours…">
        Analyser le spectre
      </SubmitButton>
    </form>
  );
}
