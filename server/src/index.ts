/**
 * Local/traditional server entry point.
 *
 * Reuses the configured Express app from `app-server.ts` (which also serves as
 * the Vercel serverless entry) and starts an HTTP listener. On Vercel the
 * platform imports the app from `app-server.ts` directly and this file is not
 * used — so the local-only `.env` loading below never runs there (Vercel
 * injects environment variables into `process.env` itself).
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Load `server/.env` into `process.env` for local development. Only sets keys
 * that are not already present, so real shell / platform env vars win. Parsing
 * is intentionally minimal (KEY=VALUE, `#` comments, optional quotes).
 */
function loadDotEnv(): void {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const envPath = resolve(here, "../.env");
    if (!existsSync(envPath)) return;
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // Non-fatal: fall back to whatever is already in process.env.
  }
}

loadDotEnv();

// Import the app AFTER loading .env so backend construction (which reads
// process.env, e.g. DATABASE_URL) sees the local values.
const { default: app } = await import("./app-server.js");

const PORT = Number(process.env.PORT ?? 3001);

app.listen(PORT, () => {
  console.log(`ByteBites API listening on http://localhost:${PORT}`);
});
