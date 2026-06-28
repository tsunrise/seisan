import { spawnSync } from "node:child_process";

import "./build-privacy-policy.mjs";

const openApi = spawnSync("pnpm", ["exec", "tsx", "scripts/generate-openapi.ts"], {
  stdio: "inherit",
});
if (openApi.error) {
  throw openApi.error;
}
if (openApi.status !== 0) {
  process.exit(openApi.status ?? 1);
}
