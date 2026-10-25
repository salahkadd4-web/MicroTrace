"use client";

import { useState, type ReactNode } from "react";
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
}: {
  title: string;
  description: string;
  requireReason?: boolean;
  onConfirm: (reason?: string) => void | Promise<void>;
  trigger: ReactNode;
  confirmLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const blocked = pending || (requireReason && reason.trim() === "");

  async function confirm() {
    setPending(true);
    try {
      await onConfirm(requireReason ? reason.trim() : undefined);
      setOpen(false);
      setReason("");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
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
