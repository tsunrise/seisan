#!/usr/bin/env -S tsx
import { automaticCategoryId, OTHERS_CATEGORY_ID } from "../src/domain/categories";
import { CATEGORY_CHALLENGES, type CategoryChallenge } from "./category-challenges";
import { SEED_CATEGORIES } from "./populate-categories";

interface ClassificationResponse {
  category: { id: string; name: string };
  score: number;
  othersScore: number;
  candidates: Array<{ category: { name: string }; score: number }>;
}

interface ChallengeResult extends CategoryChallenge {
  predictedCategory: string;
  score: number;
  candidates: Array<{ category: string; score: number }>;
  correct: boolean;
}

const OTHERS_CATEGORY_NAME = "Others";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await waitForServer(options.baseUrl);
  if (options.cleanupExperiment) {
    await deleteExperimentCategories(options.baseUrl);
    return;
  }
  if (!options.skipSeed) {
    await seedCategories(options.baseUrl);
  }
  const cookie = await createLocalSession(options.baseUrl);

  console.log(`Waiting ${options.settleSeconds}s for category publication to reach KV...`);
  await delay(options.settleSeconds * 1_000);

  const results = await mapConcurrent(CATEGORY_CHALLENGES, options.concurrency, async (challenge) =>
    evaluateChallenge(options.baseUrl, cookie, challenge),
  );
  printReport(results, options.showAll);

  if (results.some((result) => !result.correct)) {
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): {
  baseUrl: string;
  settleSeconds: number;
  concurrency: number;
  showAll: boolean;
  skipSeed: boolean;
  cleanupExperiment: boolean;
} {
  let baseUrl = "http://127.0.0.1:5174";
  let settleSeconds = 2;
  let concurrency = 4;
  let showAll = false;
  let skipSeed = false;
  let cleanupExperiment = false;

  for (const arg of args) {
    if (arg.startsWith("--base-url=")) {
      baseUrl = arg.slice("--base-url=".length);
    } else if (arg.startsWith("--settle-seconds=")) {
      settleSeconds = parsePositiveInteger(arg.slice("--settle-seconds=".length), arg);
    } else if (arg.startsWith("--concurrency=")) {
      concurrency = parsePositiveInteger(arg.slice("--concurrency=".length), arg);
    } else if (arg === "--show-all") {
      showAll = true;
    } else if (arg === "--skip-seed") {
      skipSeed = true;
    } else if (arg === "--cleanup-experiment") {
      cleanupExperiment = true;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return {
    baseUrl: new URL(baseUrl).origin,
    settleSeconds,
    concurrency,
    showAll,
    skipSeed,
    cleanupExperiment,
  };
}

function parsePositiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${option.split("=", 1)[0]} must be a positive integer.`);
  }
  return parsed;
}

async function waitForServer(baseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(new URL("/api/ping", baseUrl));
      if (response.ok) {
        return;
      }
    } catch {
      // The experimental dev server may still be starting.
    }
    await delay(1_000);
  }
  throw new Error(`Timed out waiting for ${baseUrl}.`);
}

async function seedCategories(baseUrl: string): Promise<void> {
  const existing = await requestJson<{ categories: unknown[] }>(
    new URL("/api/admin/categories", baseUrl),
    { method: "GET" },
  );
  if (existing.categories.length > 0) {
    throw new Error("The experiment state is not empty; use a fresh persistence path.");
  }

  for (const category of SEED_CATEGORIES) {
    await requestJson(new URL("/api/admin/categories", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(category),
    });
    console.log(`Seeded ${category.name}.`);
  }
}

async function deleteExperimentCategories(baseUrl: string): Promise<void> {
  const existing = await requestJson<{
    categories: Array<{ id: string; name: string }>;
  }>(new URL("/api/admin/categories", baseUrl), { method: "GET" });
  for (const category of existing.categories) {
    const response = await fetch(
      new URL(`/api/admin/categories/${encodeURIComponent(category.id)}`, baseUrl),
      { method: "DELETE" },
    );
    if (response.status !== 204) {
      throw new Error(
        `DELETE /api/admin/categories/${category.id} returned ${response.status}: ${await response.text()}`,
      );
    }
    console.log(`Deleted experimental category ${category.name}.`);
  }
  await delay(2_000);
}

async function createLocalSession(baseUrl: string): Promise<string> {
  // example.com publishes a null MX record, which login domain validation rejects. Localhost login
  // uses the fixed dev code and never sends mail, so the project's own domain is safe here.
  const email = "category-evaluation@seisan.waga.me";
  const attempt = await requestJson<{ id: string }>(new URL("/api/login/attempt", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const response = await fetch(new URL("/api/login/verify", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: attempt.id, email, code: "123456" }),
  });
  if (!response.ok) {
    throw new Error(`Login verification failed (${response.status}): ${await response.text()}`);
  }
  const setCookie = response.headers.get("set-cookie");
  const cookie = setCookie?.split(";", 1)[0];
  if (!cookie) {
    throw new Error("Login verification did not return a session cookie.");
  }
  return cookie;
}

async function evaluateChallenge(
  baseUrl: string,
  cookie: string,
  challenge: CategoryChallenge,
): Promise<ChallengeResult> {
  const classified = await classifyWithRetry(baseUrl, cookie, challenge.name);
  const predictedCategory =
    automaticCategoryId(classified) === OTHERS_CATEGORY_ID
      ? OTHERS_CATEGORY_NAME
      : classified.category.name;
  return {
    ...challenge,
    predictedCategory,
    score: classified.score,
    candidates: classified.candidates.map((candidate) => ({
      category: candidate.category.name,
      score: candidate.score,
    })),
    correct: predictedCategory === challenge.expectedCategory,
  };
}

async function classifyWithRetry(
  baseUrl: string,
  cookie: string,
  name: string,
): Promise<ClassificationResponse> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await requestJson<ClassificationResponse>(
        new URL("/api/categories/classify", baseUrl),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ name, topK: 3 }),
        },
      );
    } catch (error) {
      lastError = error;
      await delay(5_000);
    }
  }
  throw lastError;
}

async function requestJson<T = unknown>(url: URL, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${url.pathname} returned ${response.status}: ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

async function mapConcurrent<T, U>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index] as T);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

function printReport(results: readonly ChallengeResult[], showAll: boolean): void {
  const correct = results.filter((result) => result.correct).length;
  console.log(
    `\nAccuracy: ${correct}/${results.length} (${((correct / results.length) * 100).toFixed(1)}%)`,
  );

  for (const scenario of [...new Set(results.map((result) => result.scenario))]) {
    const scenarioResults = results.filter((result) => result.scenario === scenario);
    const scenarioCorrect = scenarioResults.filter((result) => result.correct).length;
    console.log(`  ${scenario}: ${scenarioCorrect}/${scenarioResults.length}`);
  }

  console.log("\nResult\tPost name\tExpected\tPredicted\tScore\tTop 3");
  for (const result of results) {
    if (!showAll && result.correct) {
      continue;
    }
    console.log(
      [
        result.correct ? "PASS" : "FAIL",
        result.name,
        result.expectedCategory,
        result.predictedCategory,
        result.score.toFixed(4),
        result.candidates
          .map((candidate) => `${candidate.category}=${candidate.score.toFixed(3)}`)
          .join(", "),
      ].join("\t"),
    );
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
