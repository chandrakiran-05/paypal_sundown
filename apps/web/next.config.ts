// Compile workspace packages and avoid bundling Node's SQLite module.
import type { NextConfig } from "next";
import dotenv from "dotenv";
import path from "node:path";
const workspaceRoot = process.cwd().endsWith(path.join("apps", "web"))
  ? path.resolve(process.cwd(), "../..")
  : process.cwd();
// Next has already loaded apps/web/.env.local; explicit process/web values take precedence.
dotenv.config({
  path: path.join(workspaceRoot, ".env.local"),
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
  outputFileTracingRoot: workspaceRoot,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;
