import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep pdf-parse and openai in the Node.js runtime bundle — do NOT
  // attempt to bundle them for the browser (they use Node-only APIs).
  serverExternalPackages: ["pdf-parse", "openai"],
};

export default nextConfig;
