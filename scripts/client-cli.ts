#!/usr/bin/env -S tsx
import { emitKeypressEvents, type Key } from "node:readline";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { isIconName, type IconName } from "../shared/icon-names";
import {
  type ApiTargetEnv,
  ApiError,
  type CategoryClassifyResponse,
  CloudflareAccessTokenError,
  DEFAULT_API_BASE_URL,
  DEV_API_BASE_URL,
  isValidApiKey,
  MissingApiKeyError,
  PRODUCTION_API_BASE_URL,
  SeisanClient,
  UnauthorizedError,
} from "./client.ts";

type CommandName =
  | "ping"
  | "whoami"
  | "logout"
  | "category-list"
  | "category-add"
  | "category-update"
  | "category-remove"
  | "classify-category";

interface Command {
  description: string;
  requiresAuth: boolean;
  usage?: string;
  run(client: SeisanClient, args: string[]): Promise<void>;
}

const commands: Record<CommandName, Command> = {
  ping: {
    description: "Call GET /ping.",
    requiresAuth: false,
    async run(client) {
      console.log(await client.ping());
    },
  },
  whoami: {
    description: "Call GET /whoami using an API key.",
    requiresAuth: true,
    async run(client) {
      const result = await client.whoami();
      console.log(result.email);
    },
  },
  logout: {
    description: "Remove the saved API key for the target environment.",
    requiresAuth: false,
    async run(client) {
      await client.logout();
      console.log("Saved API key removed.");
    },
  },
  "category-add": {
    description: "Admin: add a category classification category.",
    requiresAuth: false,
    usage: 'category-add <name> [--description="..."] [--icon=<icon-name>]',
    async run(client, args) {
      const input = parseCategoryWriteArgs(args, { requireNameFlag: false });
      printJson(await client.categoryAdd(input));
    },
  },
  "category-list": {
    description: "Admin: list category classification categories.",
    requiresAuth: false,
    usage: "category-list",
    async run(client, args) {
      if (args.length > 0) {
        throw new CliError(`Unexpected argument: ${args[0]}`);
      }
      printJson(await client.adminCategoryList());
    },
  },
  "category-update": {
    description: "Admin: update a category classification category by ID.",
    requiresAuth: false,
    usage: 'category-update <category-id> --name="..." [--description="..."] [--icon=<icon-name>]',
    async run(client, args) {
      const { id, input } = parseCategoryUpdateArgs(args);
      printJson(await client.categoryUpdate(id, input));
    },
  },
  "category-remove": {
    description: "Admin: remove a category classification category by ID.",
    requiresAuth: false,
    usage: "category-remove <category-id>",
    async run(client, args) {
      const id = parseSinglePositional(args, "category ID");
      await client.categoryRemove(id);
      console.log(`Removed category ${id}.`);
    },
  },
  "classify-category": {
    description: "Classify a post name against configured categories.",
    requiresAuth: true,
    usage: "classify-category <post-name> [--top-k=5] [--verbose]",
    async run(client, args) {
      const { input, verbose } = parseCategoryClassifyArgs(args);
      const result = await client.classifyCategory(input);
      printJson(verbose ? result : formatCategoryClassifySummary(result));
    },
  },
};

async function main(argv: string[]): Promise<void> {
  const { commandName, commandArgs, targetEnv, help } = parseArgs(argv);
  if (help || !commandName) {
    printHelp();
    return;
  }

  const command = commands[commandName];
  if (!command) {
    throw new CliError(`Unknown command: ${commandName}`);
  }

  const environmentApiKey = process.env.SEISAN_API_KEY?.trim() || undefined;
  const client = new SeisanClient({ targetEnv, apiKey: environmentApiKey });
  if (!command.requiresAuth) {
    await command.run(client, commandArgs);
    return;
  }

  try {
    await command.run(client, commandArgs);
  } catch (error) {
    if (!(error instanceof MissingApiKeyError) && !(error instanceof UnauthorizedError)) {
      throw error;
    }

    if (environmentApiKey) {
      throw new CliError(
        "SEISAN_API_KEY is invalid, expired, or revoked. Update or unset the environment variable and try again.",
      );
    }

    await readAndSaveApiKey(client);
    await command.run(client, commandArgs);
  }
}

function parseArgs(argv: string[]): {
  commandName?: CommandName;
  commandArgs: string[];
  targetEnv: ApiTargetEnv;
  help: boolean;
} {
  let commandName: CommandName | undefined;
  const commandArgs: string[] = [];
  let targetEnv: ApiTargetEnv = "local";
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--") {
      continue;
    } else if (arg === "-h" || arg === "--help") {
      help = true;
    } else if (arg.startsWith("--env=")) {
      targetEnv = parseTargetEnv(arg.slice("--env=".length));
    } else if (arg === "--env") {
      targetEnv = parseTargetEnv(readOptionValue(argv, index, "--env"));
      index += 1;
    } else if (
      arg === "--base-url" ||
      arg.startsWith("--base-url=") ||
      arg === "--access-app-url" ||
      arg.startsWith("--access-app-url=") ||
      arg === "--access-token" ||
      arg.startsWith("--access-token=")
    ) {
      throw new CliError(`${arg.split("=", 1)[0]} is no longer supported. Use --env instead.`);
    } else if (!commandName) {
      commandName = arg as CommandName;
    } else {
      commandArgs.push(arg);
    }
  }

  return { commandName, commandArgs, targetEnv, help };
}

function parseTargetEnv(value: string): ApiTargetEnv {
  if (value === "local" || value === "dev" || value === "production") {
    return value;
  }
  throw new CliError("--env must be one of: local, dev, production.");
}

function parseCategoryWriteArgs(
  args: string[],
  options: { requireNameFlag: boolean },
): { name: string; description?: string; icon?: IconName } {
  let name: string | undefined;
  let description: string | undefined;
  let icon: IconName | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg.startsWith("--name=")) {
      name = arg.slice("--name=".length);
    } else if (arg === "--name") {
      name = readOptionValue(args, index, "--name");
      index += 1;
    } else if (arg.startsWith("--description=")) {
      description = arg.slice("--description=".length);
    } else if (arg === "--description") {
      description = readOptionValue(args, index, "--description");
      index += 1;
    } else if (arg.startsWith("--icon=")) {
      icon = parseIconName(arg.slice("--icon=".length));
    } else if (arg === "--icon") {
      icon = parseIconName(readOptionValue(args, index, "--icon"));
      index += 1;
    } else if (!options.requireNameFlag && !name) {
      name = arg;
    } else {
      throw new CliError(`Unexpected argument: ${arg}`);
    }
  }

  return { name: requireNonEmpty(name, "category name"), description, icon };
}

function parseCategoryUpdateArgs(args: string[]): {
  id: string;
  input: { name: string; description?: string; icon?: IconName };
} {
  const id = args[0];
  if (!id) {
    throw new CliError("category ID is required.");
  }
  return {
    id: requireNonEmpty(id, "category ID"),
    input: parseCategoryWriteArgs(args.slice(1), { requireNameFlag: true }),
  };
}

function parseCategoryClassifyArgs(args: string[]): {
  input: { name: string; topK?: number };
  verbose: boolean;
} {
  let name: string | undefined;
  let topK: number | undefined;
  let verbose = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg.startsWith("--name=")) {
      name = arg.slice("--name=".length);
    } else if (arg === "--name") {
      name = readOptionValue(args, index, "--name");
      index += 1;
    } else if (arg.startsWith("--top-k=")) {
      topK = parseTopK(arg.slice("--top-k=".length));
    } else if (arg === "--top-k") {
      topK = parseTopK(readOptionValue(args, index, "--top-k"));
      index += 1;
    } else if (arg === "--verbose") {
      verbose = true;
    } else if (!name) {
      name = arg;
    } else {
      throw new CliError(`Unexpected argument: ${arg}`);
    }
  }

  return { input: { name: requireNonEmpty(name, "post name"), topK }, verbose };
}

function parseSinglePositional(args: string[], label: string): string {
  if (args.length !== 1) {
    throw new CliError(`Expected exactly one ${label}.`);
  }
  return requireNonEmpty(args[0], label);
}

function parseTopK(value: string): number {
  const topK = Number(value);
  if (!Number.isInteger(topK) || topK < 1 || topK > 20) {
    throw new CliError("--top-k must be an integer between 1 and 20.");
  }
  return topK;
}

function readOptionValue(args: string[], index: number, optionName: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new CliError(`${optionName} requires a value.`);
  }
  return value;
}

function requireNonEmpty(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new CliError(`${label} is required.`);
  }
  return trimmed;
}

function parseIconName(value: string): IconName {
  if (!isIconName(value)) {
    throw new CliError(`Unknown icon name: ${value}`);
  }
  return value;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function formatCategoryClassifySummary(result: CategoryClassifyResponse): {
  category: string;
  score: number;
  candidates: Array<{ category: string; score: number }>;
} {
  return {
    category: result.category.name,
    score: result.score,
    candidates: result.candidates.map((candidate) => ({
      category: candidate.category.name,
      score: candidate.score,
    })),
  };
}

async function readAndSaveApiKey(client: SeisanClient): Promise<void> {
  const apiKey = (await readHiddenLine("API key (input hidden): ")).trim();
  if (!isValidApiKey(apiKey)) {
    throw new CliError("API key has an invalid format.");
  }
  await client.saveApiKey(apiKey);
}

async function readHiddenLine(prompt: string): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    const rl = createInterface({ input, output });
    try {
      return await rl.question(prompt);
    } finally {
      rl.close();
    }
  }

  output.write(prompt);
  emitKeypressEvents(input);
  const wasPaused = input.isPaused();
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();

  return new Promise<string>((resolve, reject) => {
    let value = "";

    const finish = (result: { value: string } | { error: Error }): void => {
      input.removeListener("keypress", onKeypress);
      input.setRawMode(wasRaw);
      if (wasPaused) {
        input.pause();
      }
      output.write("\n");
      if ("error" in result) {
        reject(result.error);
      } else {
        resolve(result.value);
      }
    };

    const onKeypress = (character: string | undefined, key: Key): void => {
      if (key.ctrl && key.name === "c") {
        finish({ error: new CliError("API key entry cancelled.") });
      } else if (key.name === "return" || key.name === "enter") {
        finish({ value });
      } else if (key.name === "backspace") {
        value = Array.from(value).slice(0, -1).join("");
      } else if (!key.ctrl && !key.meta && character) {
        value += character;
      }
    };

    input.on("keypress", onKeypress);
  });
}

function printHelp(): void {
  const commandNameWidth = Math.max(...Object.keys(commands).map((name) => name.length));
  console.log(`Usage: pnpm api [--env=local|dev|production] <command>

Commands:
${Object.entries(commands)
  .map(([name, command]) => `  ${name.padEnd(commandNameWidth)} ${command.description}`)
  .join("\n")}

Authentication:
  Authenticated commands use SEISAN_API_KEY when set. Otherwise, the CLI uses a saved key or prompts for one and stores it securely. Environment keys override saved keys. Run logout to remove the saved key for the target environment.

Options:
  --env=<env>  Target environment: local (${DEFAULT_API_BASE_URL}), dev (${DEV_API_BASE_URL}), or production (${PRODUCTION_API_BASE_URL}). Defaults to local. Dev and remote admin calls run cloudflared access token automatically.
  -h, --help   Show this help message.

Admin command usage:
${Object.entries(commands)
  .filter((entry): entry is [string, Command & { usage: string }] => Boolean(entry[1].usage))
  .map(([, command]) => `  pnpm api ${command.usage}`)
  .join("\n")}
`);
}

class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof ApiError) {
    console.error(error.message);
    if (error.responseBody) {
      console.error(error.responseBody);
    }
  } else if (error instanceof CloudflareAccessTokenError) {
    console.error(error.message);
  } else if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
