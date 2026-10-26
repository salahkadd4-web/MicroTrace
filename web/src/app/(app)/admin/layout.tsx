import type { ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";
import { requirePlatformAdmin } from "@/server/platform-action";
import { logout } from "../actions";

/** Console de la plateforme : 404 pour tout autre que l'équipe (relue en base). */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requirePlatformAdmin();
  return (
    <AppShell userName={user.name} signOutAction={logout} isPlatformAdmin>
      {children}
    </AppShell>
  );
}
