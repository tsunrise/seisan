import { rm } from "node:fs/promises";

await rm(new URL("../dist/seisan/.dev.vars", import.meta.url), { force: true });
