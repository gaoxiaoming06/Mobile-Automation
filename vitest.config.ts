import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["platform/**/*.test.ts", "platform/**/*.test.tsx"],
    environment: "node"
  }
});
