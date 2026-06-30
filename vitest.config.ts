import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Tests touch sqlite/HD derivation which are CPU bound and fast; keep them serial-safe.
    pool: "threads",
  },
});
