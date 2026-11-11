// Compile workspace packages and avoid bundling Node's SQLite module.
import type { NextConfig } from "next";
import dotenv from "dotenv";
import path from "node:path";
// Next has already loaded apps/web/.env.local; explicit process/web values take precedence.
dotenv.config({
  path: path.resolve(process.cwd(), "../../.env.local"),
  quiet: true,
});
const config: NextConfig = {
  // License strings are public. Explicitly inline only this value from the root env file.
  env: {
    NEXT_PUBLIC_AG_GRID_LICENSE_KEY:
      process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY ||
      process.env.AG_GRID_LICENSE_KEY ||
      process.env.AG_STUDIO_LICENSE ||
      "",
  },
  transpilePackages: ["@sundown/engine", "@sundown/agents"],
  serverExternalPackages: ["node:sqlite", "@paypal/agent-toolkit"],
  outputFileTracingRoot: process.cwd() + "/../..",
};
export default config;
