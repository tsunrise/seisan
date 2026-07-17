import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const persistPath = process.env.CATEGORY_EXPERIMENT_STATE;
if (!persistPath) {
  throw new Error("CATEGORY_EXPERIMENT_STATE is required.");
}

export default defineConfig({
  plugins: [
    react(),
    cloudflare({
      persistState: { path: persistPath },
    }),
  ],
});
