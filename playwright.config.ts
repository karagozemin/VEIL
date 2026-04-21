import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 12_000
  },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      CLASH_LLM_API_KEY: "",
      CLASH_LLM_MODEL: process.env.CLASH_LLM_MODEL ?? "llama-3.3-70b-versatile",
      CLASH_LLM_BASE_URL: process.env.CLASH_LLM_BASE_URL ?? "https://api.groq.com/openai/v1"
    }
  }
});
