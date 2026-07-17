#!/usr/bin/env -S tsx
import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { IconName } from "../shared/icon-names";

const execFileAsync = promisify(execFile);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

type ApiTargetEnv = "local" | "dev" | "production";

interface SeedCategory {
  name: string;
  description: string;
  icon: IconName;
}

interface Category {
  id: string;
  name: string;
  normalizedName: string;
  description: string;
  icon?: IconName;
}

interface CategoryListResponse {
  categories: Category[];
}

export const SEED_CATEGORIES: readonly SeedCategory[] = [
  {
    name: "Dining Out",
    icon: "restaurant",
    description:
      "Restaurants and prepared food including Saigon Seafood Harbor, cafes, bakeries, tea and coffee shops, coffee before a train or at a station, bars, takeout, delivery, fast food, airport snacks, breakfast, lunch, and dinner",
  },
  {
    name: "Groceries",
    icon: "grocery",
    description:
      "Supermarkets and grocery stores including 99 Ranch, Safeway, Trader Joe's, Whole Foods, and Costco groceries; food markets, vegetables, eggs, produce, meat, seafood, ingredients, pantry staples, and food to prepare at home",
  },
  {
    name: "Rent",
    icon: "home",
    description:
      "Apartment rent, house rent, room rent, mortgage, lease payments, and recurring payments to a landlord or property manager",
  },
  {
    name: "Home Internet & Utility Bills",
    icon: "utilities",
    description:
      "Recurring home-provider bills including internet, Wi-Fi, Comcast, Xfinity, electricity, power, PG&E natural gas, water, sewer, garbage collection bills, city trash pickup utilities, Waste Management, and phone service",
  },
  {
    name: "Household Supplies & Appliances",
    icon: "household",
    description:
      "Physical goods for a shared apartment including garbage bags, facial tissue, toilet paper, detergent, paper goods, furniture such as sofas and couches, appliances such as vacuum cleaners, Bissell, Roomba, microwaves and air fryers, kitchenware, cookware, and tools",
  },
  {
    name: "Fuel & Charging",
    icon: "fuel",
    description:
      "Fuel stations and vehicle energy including Shell, Chevron, Exxon, BP, gasoline, gas, petrol, diesel, ChargePoint, Tesla Supercharger, and EV charging",
  },
  {
    name: "Vehicle Rental & Maintenance",
    icon: "vehicle",
    description:
      "Operating a group vehicle other than fuel, parking, or tolls; Hertz, Enterprise Rent-A-Car, Avis Rent a Car, Avis car rental, rental vehicles, oil changes, tires, repairs, roadside assistance, car washes, and maintenance",
  },
  {
    name: "Parking & Tolls",
    icon: "parking",
    description:
      "Parking garages and meters at hotels, airports, or stations; FasTrak, toll roads, turnpikes, congestion charges, Golden Gate Bridge tolls, and other road-use fees",
  },
  {
    name: "Public Transit & Rideshare",
    icon: "transit",
    description:
      "Passenger rail including JR, Caltrain, Amtrak, Eurostar, and Shinkansen; commuter trains, subway, metro, buses, trams, taxis, Uber, Lyft, and ground transit tickets or passes",
  },
  {
    name: "Flights",
    icon: "travel",
    description:
      "Airline tickets and airfare including United, Delta, ANA, Southwest Airlines tickets, flights, checked baggage, seat selection, and other charges attached to air travel",
  },
  {
    name: "Lodging",
    icon: "lodging",
    description:
      "Hotels, motels, hostels, resorts, inns, vacation rentals, Airbnb, campsites, and overnight accommodation",
  },
  {
    name: "Cruises & Ferries",
    icon: "cruise",
    description:
      "Cruise fares, passenger ships, ocean liners, overnight ships, ferries, water taxis, and tickets whose purpose is transportation by boat",
  },
  {
    name: "Travel Connectivity",
    icon: "connectivity",
    description:
      "Travel SIM cards, eSIM plans, international roaming, portable Wi-Fi, pocket Wi-Fi, and temporary mobile data bought for a trip",
  },
  {
    name: "Activities & Entertainment",
    icon: "entertainment",
    description:
      "Tours, sightseeing, museums, theme parks, national parks, attractions, concerts, movies, sporting events, games, recreation, and admission tickets",
  },
  {
    name: "Digital Subscriptions",
    icon: "subscription",
    description:
      "Recurring paid digital products including software, AI services, streaming music or video, news, apps, cloud storage, and online memberships",
  },
  {
    name: "Shopping",
    icon: "shopping",
    description:
      "Personal clothing, shoes, electronics, souvenirs, gifts, accessories, department stores, online retail, and general merchandise not bought for the shared home",
  },
  {
    name: "Health Care",
    icon: "medical",
    description:
      "Doctors, dentists, hospitals, urgent care, clinics, prescriptions, pharmacies, medical treatment, copays, and medical supplies",
  },
  {
    name: "Personal Care Services",
    icon: "personal-care",
    description:
      "Haircuts, hair salons, barbers, manicures, spas, massages, facials, grooming appointments, and other personal care services",
  },
  {
    name: "Insurance Premiums",
    icon: "insurance",
    description:
      "Payments specifically for insurance policies and coverage, including renters insurance, homeowners insurance, auto insurance, health insurance, travel insurance, and premiums",
  },
];

async function main(argv: string[]): Promise<void> {
  const { env, help } = parseArgs(argv);
  if (help) {
    printHelp();
    return;
  }

  console.log(`Populating categories in ${env}.`);
  const existing = await listCategories(env);
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const category of SEED_CATEGORIES) {
    const normalizedName = normalizeCategoryName(category.name);
    const match = existing.categories.find(
      (existingCategory) => existingCategory.normalizedName === normalizedName,
    );

    if (!match) {
      await addCategory(env, category);
      console.log(`Added ${category.name}.`);
      added += 1;
      continue;
    }

    if (
      normalizeText(match.name) === normalizeText(category.name) &&
      normalizeText(match.description) === normalizeText(category.description) &&
      match.icon === category.icon
    ) {
      console.log(`Skipped ${category.name}; category is unchanged.`);
      skipped += 1;
      continue;
    }

    await updateCategory(env, match.id, category);
    console.log(`Updated ${category.name} (${match.id}).`);
    updated += 1;
  }

  console.log(`Done. Added: ${added}. Updated: ${updated}. Skipped: ${skipped}.`);
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

async function listCategories(env: ApiTargetEnv): Promise<CategoryListResponse> {
  return runCliJson<CategoryListResponse>(env, ["category-list"]);
}

async function addCategory(env: ApiTargetEnv, category: SeedCategory): Promise<void> {
  await runCli(env, [
    "category-add",
    category.name,
    `--description=${category.description}`,
    `--icon=${category.icon}`,
  ]);
}

async function updateCategory(
  env: ApiTargetEnv,
  id: string,
  category: SeedCategory,
): Promise<void> {
  await runCli(env, [
    "category-update",
    id,
    `--name=${category.name}`,
    `--description=${category.description}`,
    `--icon=${category.icon}`,
  ]);
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
      { cause: error },
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
  console.log(`Usage: pnpm run categories:populate -- [--env=local|dev|production]

Seeds the default category set through the production category admin API.
Existing categories with matching normalized names are updated in place when
their name or description differs.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
