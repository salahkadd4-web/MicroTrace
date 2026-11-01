"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { FormError } from "@/components/app/FormError";
import { FormField } from "@/components/app/FormField";
import { SubmitButton } from "@/components/app/SubmitButton";
import { Input } from "@/components/ui/input";
import { IMAGE_ACCEPT, IMAGE_MAX_BYTES } from "@/lib/images";

const TOO_BIG = "Fichier trop volumineux (25 Mo maximum).";
const NO_FILE = "Choisissez l'image à analyser.";
const UPLOAD_FAILED = "Échec de l'envoi du fichier.";

/** Dépôt d'une image : le serveur analyse et enregistre ; succès → page de l'analyse. */
export function AnalyzeImageForm({ labSlug, studyId }: { labSlug: string; studyId: string }) {
  const router = useRouter();
  const [scale, setScale] = useState("");
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
    if (file.size > IMAGE_MAX_BYTES) {
      setError(TOO_BIG);
      return;
    }
    setError(undefined);
    setPending(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("scale_um_per_px", scale.trim());
      let res: Response;
      try {
        res = await fetch(`/labo/${labSlug}/etudes/${studyId}/images/analyser`, {
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
      router.push(`/labo/${labSlug}/etudes/${studyId}/images/${json.id}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-4">
      <FormField id="image-file" label="Image de microscopie">
        <Input
          id="image-file"
          type="file"
          accept={IMAGE_ACCEPT}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError(undefined);
          }}
        />
        <p className="text-xs text-muted-foreground">PNG, JPEG ou TIFF, 25 Mo au plus.</p>
      </FormField>
      <FormField id="image-scale" label="Échelle (µm par pixel)">
        <Input
          id="image-scale"
          inputMode="decimal"
          value={scale}
          onChange={(e) => setScale(e.target.value)}
          aria-describedby="image-scale-hint"
          className="max-w-40"
        />
        <p id="image-scale-hint" className="text-xs text-muted-foreground">
          Laissez vide pour un TIFF de MEB Hitachi (échelle lue dans l&apos;image) ; sinon, sans
          échelle, les tailles restent en pixels.
        </p>
      </FormField>
      <FormError message={error} />
      <SubmitButton pending={pending} pendingLabel="Analyse en cours…">
        Analyser l&apos;image
      </SubmitButton>
    </form>
  );
}
