import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { clearSpecsContext, generateSpecs } from "hono-openapi";
import { format, resolveConfig } from "prettier";

import { app } from "../worker/app";
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
  if (
    spec.paths["/api/api-keys"] ||
    spec.paths["/api/logout"] ||
    spec.paths["/api/login/attempt"] ||
    spec.paths["/api/login/verify"]
  ) {
    throw new Error("Generated OpenAPI spec must not include cookie-only auth routes.");
  }
  if (!isApiKeyBearerScheme(spec.components?.securitySchemes?.apiKeyBearer)) {
    throw new Error("Generated OpenAPI spec is missing the API key bearer security scheme.");
  }
  const serialized = JSON.stringify(spec);
  if (serialized.includes("sessionCookie") || serialized.includes("__Host-seisan_session")) {
    throw new Error("Generated OpenAPI spec must not mention session cookie auth.");
  }
  assertDocumentationQuality(spec.paths);
}

function assertDocumentationQuality(paths: unknown): void {
  if (!isObjectRecord(paths)) {
    throw new Error("Generated OpenAPI spec is missing documented paths.");
  }

  const methods = new Set(["get", "post", "put", "patch", "delete"]);
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!isObjectRecord(pathItem)) {
      continue;
    }
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!methods.has(method) || !isObjectRecord(operation)) {
        continue;
      }
      const operationLabel = `${method.toUpperCase()} ${path}`;
      if (typeof operation.description !== "string" || operation.description.trim() === "") {
        throw new Error(`${operationLabel} is missing an OpenAPI description.`);
      }
      assertParameters(operation.parameters, operationLabel);
      assertRequestBody(operation.requestBody, operationLabel);
      assertSuccessResponses(operation.responses, operationLabel);
    }
  }
}

function assertParameters(parameters: unknown, operationLabel: string): void {
  if (parameters === undefined) {
    return;
  }
  if (!Array.isArray(parameters)) {
    throw new Error(`${operationLabel} has invalid OpenAPI parameters.`);
  }
  for (const parameter of parameters) {
    if (!isObjectRecord(parameter)) {
      throw new Error(`${operationLabel} has an invalid OpenAPI parameter.`);
    }
    const name = typeof parameter.name === "string" ? parameter.name : "unknown";
    if (typeof parameter.description !== "string" || parameter.description.trim() === "") {
      throw new Error(`${operationLabel} parameter ${name} is missing a description.`);
    }
    if (!isObjectRecord(parameter.schema) || !Object.hasOwn(parameter.schema, "example")) {
      throw new Error(`${operationLabel} parameter ${name} is missing an example.`);
    }
  }
}

function assertRequestBody(requestBody: unknown, operationLabel: string): void {
  if (requestBody === undefined) {
    return;
  }
  if (!isObjectRecord(requestBody) || !isObjectRecord(requestBody.content)) {
    throw new Error(`${operationLabel} has an invalid OpenAPI request body.`);
  }
  const mediaType = requestBody.content["application/json"];
  assertDocumentedMediaType(mediaType, `${operationLabel} request body`);
}

function assertSuccessResponses(responses: unknown, operationLabel: string): void {
  if (!isObjectRecord(responses)) {
    throw new Error(`${operationLabel} is missing OpenAPI responses.`);
  }
  for (const [status, response] of Object.entries(responses)) {
    if (!/^2\d\d$/u.test(status) || status === "204") {
      continue;
    }
    if (!isObjectRecord(response) || !isObjectRecord(response.content)) {
      throw new Error(`${operationLabel} response ${status} is missing documented content.`);
    }
    const mediaType = response.content["application/json"] ?? response.content["text/plain"];
    assertDocumentedMediaType(mediaType, `${operationLabel} response ${status}`);
  }
}

function assertDocumentedMediaType(mediaType: unknown, label: string): void {
  if (!isObjectRecord(mediaType) || !Object.hasOwn(mediaType, "example")) {
    throw new Error(`${label} is missing an example.`);
  }
  assertSchemaPropertyDescriptions(mediaType.schema, label);
}

function assertSchemaPropertyDescriptions(schema: unknown, label: string): void {
  if (!isObjectRecord(schema)) {
    throw new Error(`${label} is missing a schema.`);
  }
  if (isObjectRecord(schema.properties)) {
    for (const [propertyName, propertySchema] of Object.entries(schema.properties)) {
      if (
        !isObjectRecord(propertySchema) ||
        typeof propertySchema.description !== "string" ||
        propertySchema.description.trim() === ""
      ) {
        throw new Error(`${label} property ${propertyName} is missing a description.`);
      }
      assertNestedSchemaDescriptions(propertySchema, `${label}.${propertyName}`);
    }
  }
  assertNestedSchemaDescriptions(schema, label);
}

function assertNestedSchemaDescriptions(schema: Record<string, unknown>, label: string): void {
  if (isObjectRecord(schema.items)) {
    assertSchemaPropertyDescriptions(schema.items, `${label}[]`);
  }
  for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
    const variants = schema[keyword];
    if (!Array.isArray(variants)) {
      continue;
    }
    for (const [index, variant] of variants.entries()) {
      assertSchemaPropertyDescriptions(variant, `${label}.${keyword}[${index}]`);
    }
  }
}

function isApiKeyBearerScheme(value: unknown): boolean {
  if (!isObjectRecord(value)) {
    return false;
  }
  return (
    value.type === "http" && value.scheme === "bearer" && value.bearerFormat === "seisan_v1 API key"
  );
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
