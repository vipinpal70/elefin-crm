import path from "node:path";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

// Monorepo: the shared .env lives at the repo root, not in apps/web.
loadEnv({ path: path.resolve(process.cwd(), "../../.env") });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace TS packages are shipped as source; let Next compile them.
  transpilePackages: ["@elefin/db", "@elefin/domain", "@elefin/elefin-client"],
  // Mongoose must not be bundled — it uses dynamic requires.
  serverExternalPackages: ["mongoose", "bcryptjs"],
};

export default nextConfig;
