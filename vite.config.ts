import vinext from "vinext";
import { defineConfig } from "vite";

// macOS Seatbelt blocks FSEvents, so sandboxed previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

/**
 * Bindings for local dev. The only server-side state is USAGE_DB: anonymous
 * daily totals of visits and tool runs. Documents are never stored or sent.
 *
 * The deployable config is generated from this by @cloudflare/vite-plugin at
 * dist/server/wrangler.json during `npm run build`; that is the file
 * `npm run deploy` hands to Wrangler.
 */
const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: [
    {
      binding: "USAGE_DB",
      database_name: "jadjang-usage",
      database_id: "88c36410-2418-4137-a34d-6ee54b82d449",
    },
  ],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
