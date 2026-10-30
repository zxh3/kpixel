import { defineConfig } from "vitest/config";

// Unit tests run in Node without the app's Vite plugins (Cloudflare, TanStack Start),
// which are only needed for the app build.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
