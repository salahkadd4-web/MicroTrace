import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div className="flex justify-center py-16">
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Chargement…
      </p>
    </div>
  );
}
