import "server-only";
import { headers } from "next/headers";

/** Origine des liens affichés : `APP_URL` si définie, sinon déduite de l'en-tête de la requête. */
export async function appOrigin(): Promise<string> {
  const fixed = process.env.APP_URL?.trim();
  if (fixed) return fixed.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = h.get("x-forwarded-proto") ?? (local ? "http" : "https");
  return `${proto}://${host}`;
}
