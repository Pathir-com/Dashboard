import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.test" });

/* Shim for Deno globals used at module-load by `_shared/*.ts` files —
   we import them as pure helpers (e.g. resolveProvider) without running
   the edge-function runtime. Anything that actually calls Deno.serve at
   runtime is invoked via HTTP, not imported, so this shim is enough. */
if (typeof (globalThis as any).Deno === "undefined") {
  (globalThis as any).Deno = {
    env: {
      get: (k: string) => process.env[k],
      set: (k: string, v: string) => { process.env[k] = v; },
    },
    serve: () => { throw new Error("Deno.serve called from Node — invoke via HTTP instead"); },
  };
}
