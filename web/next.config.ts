import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sortie autonome : l'image Docker n'embarque que ce qui est nécessaire à l'exécution.
  output: "standalone",
  // Les tests de bout en bout compilent dans un dossier à part (NEXT_DIST_DIR) pour ne pas
  // écraser le `.next` du développeur ; sans la variable, le comportement est inchangé.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
