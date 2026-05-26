import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc", environment: "dev" },
      miniflare: {
        bindings: {
          AUTH_SECRET: "test-auth-secret-at-least-32-bytes",
          LOGIN_EMAIL_FROM: "login@example.com",
          ALLOWED_LOGIN_EMAILS: "yehvd9bbu@mozmail.com",
        },
      },
    }),
  ],
});
