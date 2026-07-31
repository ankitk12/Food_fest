/**
 * Local/traditional server entry point.
 *
 * Reuses the configured Express app from `app-server.ts` (which also serves as
 * the Vercel serverless entry) and starts an HTTP listener. On Vercel the
 * platform imports the app from `app-server.ts` directly and this file is not
 * used.
 */

import app from "./app-server.js";

const PORT = Number(process.env.PORT ?? 3001);

app.listen(PORT, () => {
  console.log(`ByteBites API listening on http://localhost:${PORT}`);
});
