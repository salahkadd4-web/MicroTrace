"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Lien d'invitation affiché une seule fois, avec un bouton de copie. */
export function InvitationLink({ link }: { link: string }) {
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied("yes");
    } catch {
      setCopied("no");
    }
  }

  return (
    <div className="space-y-2 rounded-lg border p-4">
      <Label htmlFor="invitation-link">Lien d&apos;invitation</Label>
      <div className="flex gap-2">
        <Input id="invitation-link" readOnly value={link} onFocus={(e) => e.target.select()} />
        <Button type="button" variant="outline" onClick={copy}>
          Copier le lien
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Ce lien n&apos;est affiché qu&apos;une seule fois : copiez-le maintenant. Il est valable 7
        jours et ne peut servir qu&apos;une fois.
      </p>
      <p role="status" className="text-sm">
        {copied === "yes" ? "Lien copié." : null}
        {copied === "no" ? "Copie impossible : sélectionnez le lien et copiez-le à la main." : null}
      </p>
    </div>
  );
}
