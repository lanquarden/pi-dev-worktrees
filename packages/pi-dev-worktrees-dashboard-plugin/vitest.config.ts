import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    globalSetup: ["@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts"],
  },
});
