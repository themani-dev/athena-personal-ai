// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Override nitro preset from cloudflare-module → bun for self-hosted Docker deployment.
  // Lovable cloud builds continue to work (they inject their own preset override).
  nitro: {
    preset: "bun",
  },
  vite: {
    server: {
      proxy: {
        // Proxy /api/dashboard → local Python data server (api/dashboard.py --serve)
        // In production Docker, nginx proxies /api/ to the api container directly.
        "/api/dashboard": {
          target: "http://127.0.0.1:5175",
          changeOrigin: true,
        },
      },
    },
  },
});
