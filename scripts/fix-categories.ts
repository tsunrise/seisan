#!/usr/bin/env -S tsx
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ApiError, SeisanClient, type ApiTargetEnv } from "./client";

interface FixOptions {
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
  let result;
  try {
    result = await client.categoryFix({ dryRun: options.dryRun });
  } catch (error) {
    if (error instanceof ApiError && error.response.status === 404) {
      throw new Error(
        `No category document is stored in ${options.env}. Run categories:populate instead.`,
        { cause: error },
      );
    }
    throw error;
  }

  for (const category of result.removed) {
    const label = `${category.name ?? "<unnamed>"} (${category.id ?? "no id"})`;
    console.log(options.dryRun ? `Would remove ${label}.` : `Removed ${label}.`);
  }

  if (!result.changed) {
    console.log(
      options.dryRun
        ? `Category document in ${options.env} is already compatible.`
        : `Category document in ${options.env} is already compatible. Republished it.`,
    );
    return;
  }

  console.log(
    options.dryRun
      ? `Dry run complete. Would keep ${result.categories.length} and remove ${result.removed.length}.`
      : `Fix complete. Kept ${result.categories.length}, removed ${result.removed.length}.`,
  );
}

function parseArgs(argv: string[]): FixOptions {
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

function printHelp(): void {
  console.log(`Usage: pnpm run categories:fix -- [--env=local|dev|production] [--dry-run]

Rewrites a stored category document that the current schema no longer accepts,
such as a version-1 document, and republishes it. Categories keep their IDs when
they are still valid after dropping retired fields; categories that remain
invalid are removed. Run categories:populate and categories:cleanup afterwards
to converge on the current seed taxonomy.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
