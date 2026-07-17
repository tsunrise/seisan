#!/usr/bin/env -S tsx
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SeisanClient, type ApiTargetEnv, type Category } from "./client";
import { SEED_CATEGORIES } from "./populate-categories";

interface CleanupOptions {
  env: ApiTargetEnv;
  dryRun: boolean;
  help: boolean;
}

async function main(argv: string[]): Promise<void> {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }

  const client = new SeisanClient({ targetEnv: options.env });
  const { categories } = await client.adminCategoryList();
  const desiredNames = new Set(
    SEED_CATEGORIES.map((category) => normalizeCategoryName(category.name)),
  );
  const existingNames = new Set(categories.map((category) => category.normalizedName));
  const missing = [...desiredNames].filter((name) => !existingNames.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Refusing cleanup because these seed categories are missing: ${missing.join(", ")}. Run categories:populate first.`,
    );
  }

  const obsolete = obsoleteCategories(categories, desiredNames);
  if (obsolete.length === 0) {
    console.log(`No obsolete categories found in ${options.env}.`);
    return;
  }

  for (const category of obsolete) {
    if (options.dryRun) {
      console.log(`Would remove ${category.name} (${category.id}).`);
      continue;
    }
    await client.categoryRemove(category.id);
    console.log(`Removed ${category.name} (${category.id}).`);
  }

  console.log(
    options.dryRun
      ? `Dry run complete. Obsolete categories: ${obsolete.length}.`
      : `Cleanup complete. Removed: ${obsolete.length}.`,
  );
}

export function obsoleteCategories(
  categories: readonly Category[],
  desiredNormalizedNames: ReadonlySet<string>,
): Category[] {
  return categories.filter((category) => !desiredNormalizedNames.has(category.normalizedName));
}

function parseArgs(argv: string[]): CleanupOptions {
  let env: ApiTargetEnv = "local";
  let dryRun = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--") {
      continue;
    } else if (arg === "-h" || arg === "--help") {
      help = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("--env=")) {
      env = parseTargetEnv(arg.slice("--env=".length));
    } else if (arg === "--env") {
      env = parseTargetEnv(readOptionValue(argv, index, "--env"));
      index += 1;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return { env, dryRun, help };
}

function parseTargetEnv(value: string): ApiTargetEnv {
  if (value === "local" || value === "dev" || value === "production") {
    return value;
  }
  throw new Error("--env must be one of: local, dev, production.");
}

function readOptionValue(args: string[], index: number, optionName: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${optionName} requires a value.`);
  }
  return value;
}

function normalizeCategoryName(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

function printHelp(): void {
  console.log(`Usage: pnpm run categories:cleanup -- [--env=local|dev|production] [--dry-run]

Removes categories that are not in the current seed taxonomy. Cleanup refuses
to run until every seed category exists, so run categories:populate first.
Records that reference a removed category render as uncategorized expenses.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
