"use client";

import { useState, type ReactNode } from "react";
import { FormError } from "@/components/app/FormError";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ConfirmDialog({
  title,
  description,
  requireReason = false,
  onConfirm,
  trigger,
  confirmLabel = "Confirmer",
  open: openProp,
  onOpenChange,
}: {
  title: string;
  description: string;
  requireReason?: boolean;
  /** Renvoie un message d'erreur pour garder le dialogue ouvert ; rien (ou une promesse sans valeur) pour fermer. */
  onConfirm: (reason?: string) => void | string | undefined | Promise<void | string | undefined>;
  /** Sans déclencheur, le dialogue est piloté par `open` / `onOpenChange`. */
  trigger?: ReactNode;
  confirmLabel?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const open = openProp ?? innerOpen;
  const setOpen = (value: boolean) => {
    setInnerOpen(value);
    onOpenChange?.(value);
  };
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const blocked = pending || (requireReason && reason.trim() === "");

  async function confirm() {
    setPending(true);
    try {
      const failure = await onConfirm(requireReason ? reason.trim() : undefined);
      if (failure) {
        setError(failure);
        return;
      }
      setError(undefined);
      setOpen(false);
      setReason("");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {requireReason ? (
          <div className="space-y-2">
            <Label htmlFor="confirm-reason">Motif</Label>
            <Textarea
              id="confirm-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        ) : null}
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Annuler
          </Button>
          <Button onClick={confirm} disabled={blocked}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
