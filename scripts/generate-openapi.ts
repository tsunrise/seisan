import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { clearSpecsContext, generateSpecs } from "hono-openapi";
import { format, resolveConfig } from "prettier";

import { app } from "../worker/app";
import { SESSION_COOKIE_NAME } from "../worker/constants";
import { OpenApiSpecOptions } from "../worker/model";

const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), "../public/openapi.json");

async function main(): Promise<void> {
  const openApiJson = await generateOpenApiJson();
  if (process.argv.includes("--check")) {
    await checkGeneratedFile(openApiJson);
    return;
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, openApiJson);
}

async function generateOpenApiJson(): Promise<string> {
  clearSpecsContext();
  const spec = await generateSpecs(app, OpenApiSpecOptions);
  assertOpenApiSpec(spec);
  const prettierOptions = (await resolveConfig(outputPath)) ?? {};
  return format(JSON.stringify(spec), { ...prettierOptions, parser: "json" });
}

async function checkGeneratedFile(expected: string): Promise<void> {
  let current: string;
  try {
    current = await readFile(outputPath, "utf8");
  } catch {
    throw new Error(`Missing generated OpenAPI file at ${outputPath}.`);
  }

  if (current !== expected) {
    throw new Error(
      `Generated OpenAPI file is stale. Run "pnpm run openapi:generate" to update ${outputPath}.`,
    );
  }
}

function assertOpenApiSpec(spec: Awaited<ReturnType<typeof generateSpecs>>): void {
  if (spec.openapi !== "3.1.0") {
    throw new Error(`Expected OpenAPI 3.1.0, received ${spec.openapi}.`);
  }
  if (!spec.paths["/api/project/{id}"]) {
    throw new Error("Generated OpenAPI spec is missing /api/project/{id}.");
  }
  if (spec.paths["/api/admin/projects"]) {
    throw new Error("Generated OpenAPI spec must not include /api/admin/projects.");
  }
  if (!isSessionCookieScheme(spec.components?.securitySchemes?.sessionCookie)) {
    throw new Error("Generated OpenAPI spec is missing the session cookie security scheme.");
  }
}

function isSessionCookieScheme(value: unknown): boolean {
  if (!isObjectRecord(value)) {
    return false;
  }
  return value.type === "apiKey" && value.in === "cookie" && value.name === SESSION_COOKIE_NAME;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
