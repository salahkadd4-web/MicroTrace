import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sortie autonome : l'image Docker n'embarque que ce qui est nécessaire à l'exécution.
  output: "standalone",
};

export default nextConfig;
