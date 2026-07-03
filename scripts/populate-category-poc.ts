#!/usr/bin/env -S tsx
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

type ApiTargetEnv = "local" | "dev" | "production";

interface SeedCategory {
  name: string;
  description: string;
}

interface CategoryPocCategory {
  id: string;
  name: string;
  normalizedName: string;
  description: string;
}

interface CategoryPocListCategoriesResponse {
  categories: CategoryPocCategory[];
}

const SEED_CATEGORIES: readonly SeedCategory[] = [
  {
    name: "Restaurant",
    description:
      "Prepared meals, cafes, bars, bakeries, coffee shops, takeout, delivery, fast food, dining out",
  },
  {
    name: "Grocery",
    description:
      "Supermarkets, grocery stores, markets, food ingredients, pantry staples, household food purchases",
  },
  {
    name: "Transportation: Gas/Fuel",
    description:
      "Gas stations, gasoline, diesel, fuel purchases, EV charging, service station fuel",
  },
  {
    name: "Transportation: Transit/Rideshare",
    description: "Buses, trains, subway, ferry, taxis, rideshare, parking, tolls, commuter passes",
  },
  {
    name: "Housing: Rent/Mortgage",
    description:
      "Rent payments, mortgage payments, property management charges, housing lease payments, apartment rent",
  },
  {
    name: "Housing: Utilities",
    description:
      "Electricity, gas, water, sewer, trash, internet, phone, utility bills, broadband service",
  },
  {
    name: "Health: Medical/Pharmacy",
    description:
      "Doctors, dentists, hospitals, clinics, prescriptions, pharmacy, medical insurance copays, urgent care",
  },
  {
    name: "Shopping: General Merchandise",
    description:
      "Retail stores, online shopping, clothing, electronics, household goods, department stores, marketplace purchases",
  },
  {
    name: "Entertainment: Media/Events",
    description:
      "Movies, concerts, tickets, games, streaming subscriptions, books, music, hobbies, recreation",
  },
  {
    name: "Travel: Lodging/Airfare",
    description:
      "Hotels, lodging, airfare, airlines, booking sites, rental cars, travel reservations, vacation expenses",
  },
  {
    name: "Financial: Fees/Transfers",
    description:
      "Bank fees, service charges, interest, ATM fees, account transfers, payment processing, finance charges",
  },
  {
    name: "Personal Care",
    description:
      "Haircuts, salons, grooming, cosmetics, toiletries, spa services, personal hygiene purchases",
  },
  {
    name: "Education",
    description:
      "Tuition, classes, courses, school supplies, books for study, training, certification fees",
  },
  {
    name: "Insurance",
    description:
      "Auto insurance, health insurance, renters insurance, homeowners insurance, premiums, policy payments",
  },
  {
    name: "Subscriptions: Software/Services",
    description:
      "Software subscriptions, cloud services, app subscriptions, memberships, recurring digital service payments",
  },
];

async function main(argv: string[]): Promise<void> {
  const { env, help } = parseArgs(argv);
  if (help) {
    printHelp();
    return;
  }

  console.log(`Populating category POC categories in ${env}.`);
  const existing = await listCategories(env);
  let added = 0;
  let replaced = 0;
  let skipped = 0;

  for (const category of SEED_CATEGORIES) {
    const normalizedName = normalizeCategoryName(category.name);
    const matches = existing.categories.filter(
      (existingCategory) => existingCategory.normalizedName === normalizedName,
    );

    if (matches.length === 0) {
      await addCategory(env, category);
      console.log(`Added ${category.name}.`);
      added += 1;
      continue;
    }

    if (
      matches.length === 1 &&
      normalizeText(matches[0]?.description ?? "") === normalizeText(category.description)
    ) {
      console.log(`Skipped ${category.name}; description is unchanged.`);
      skipped += 1;
      continue;
    }

    console.log(`Replacing ${category.name}; description changed.`);
    for (const match of matches) {
      await removeCategory(env, match.id);
      console.log(`Deleted ${match.name} (${match.id}).`);
    }
    await addCategory(env, category);
    console.log(`Added ${category.name}.`);
    replaced += 1;
  }

  console.log(`Done. Added: ${added}. Replaced: ${replaced}. Skipped: ${skipped}.`);
}

function parseArgs(argv: string[]): { env: ApiTargetEnv; help: boolean } {
  let env: ApiTargetEnv = "local";
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--") {
      continue;
    } else if (arg === "-h" || arg === "--help") {
      help = true;
    } else if (arg.startsWith("--env=")) {
      env = parseTargetEnv(arg.slice("--env=".length));
    } else if (arg === "--env") {
      env = parseTargetEnv(readOptionValue(argv, index, "--env"));
      index += 1;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return { env, help };
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

async function listCategories(env: ApiTargetEnv): Promise<CategoryPocListCategoriesResponse> {
  return runCliJson<CategoryPocListCategoriesResponse>(env, ["category-poc-list"]);
}

async function addCategory(env: ApiTargetEnv, category: SeedCategory): Promise<void> {
  await runCli(env, ["category-poc-add", category.name, `--description=${category.description}`]);
}

async function removeCategory(env: ApiTargetEnv, id: string): Promise<void> {
  await runCli(env, ["category-poc-remove", id]);
}

async function runCliJson<T>(env: ApiTargetEnv, args: string[]): Promise<T> {
  const stdout = await runCli(env, args);
  const jsonStart = stdout.indexOf("{");
  const jsonEnd = stdout.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd < jsonStart) {
    throw new Error(`CLI command did not return JSON: pnpm api --env=${env} ${args.join(" ")}`);
  }
  return JSON.parse(stdout.slice(jsonStart, jsonEnd + 1)) as T;
}

async function runCli(env: ApiTargetEnv, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("pnpm", ["api", `--env=${env}`, ...args], {
      cwd: REPO_ROOT,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    throw new Error(
      `CLI command failed: pnpm api --env=${env} ${args.join(" ")}\n${formatExecError(error)}`,
    );
  }
}

function normalizeCategoryName(value: string): string {
  return normalizeText(value).toLowerCase();
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function formatExecError(error: unknown): string {
  const stderr = readStringProperty(error, "stderr")?.trim();
  if (stderr) {
    return stderr;
  }

  const stdout = readStringProperty(error, "stdout")?.trim();
  if (stdout) {
    return stdout;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function readStringProperty(value: unknown, property: string): string | undefined {
  if (!value || typeof value !== "object" || !(property in value)) {
    return undefined;
  }
  const result = value[property as keyof typeof value];
  return typeof result === "string" ? result : undefined;
}

function printHelp(): void {
  console.log(`Usage: pnpm run category-poc:populate -- [--env=local|dev|production]

Seeds the category POC catalog through the existing pnpm api CLI.

Options:
  --env=<env>  Target environment. Defaults to local.
  -h, --help   Show this help message.
`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
