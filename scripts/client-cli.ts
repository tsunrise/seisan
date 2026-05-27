#!/usr/bin/env -S tsx
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  ApiError,
  DEFAULT_API_BASE_URL,
  MissingSessionError,
  SeisanClient,
  UnauthorizedError,
} from "./client.ts";

type CommandName = "ping" | "whoami" | "logout";

interface Command {
  description: string;
  requiresAuth: boolean;
  run(client: SeisanClient): Promise<void>;
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
    description: "Call GET /whoami, logging in first if no saved session exists.",
    requiresAuth: true,
    async run(client) {
      const result = await client.whoami();
      console.log(result.email);
    },
  },
  logout: {
    description: "Call POST /logout and clear the saved local session.",
    requiresAuth: false,
    async run(client) {
      await client.logout();
      console.log("Logged out.");
    },
  },
};

async function main(argv: string[]): Promise<void> {
  const { commandName, baseUrl, help } = parseArgs(argv);
  if (help || !commandName) {
    printHelp();
    return;
  }

  const command = commands[commandName];
  if (!command) {
    throw new CliError(`Unknown command: ${commandName}`);
  }

  const client = new SeisanClient({ baseUrl });
  if (!command.requiresAuth) {
    await command.run(client);
    return;
  }

  try {
    await command.run(client);
  } catch (error) {
    if (!(error instanceof MissingSessionError) && !(error instanceof UnauthorizedError)) {
      throw error;
    }

    await loginInteractively(client);
    await command.run(client);
  }
}

function parseArgs(argv: string[]): {
  commandName?: CommandName;
  baseUrl: string;
  help: boolean;
} {
  let commandName: CommandName | undefined;
  let baseUrl = process.env.SEISAN_API_URL ?? DEFAULT_API_BASE_URL;
  let help = false;

  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") {
      help = true;
    } else if (arg.startsWith("--base-url=")) {
      baseUrl = arg.slice("--base-url=".length);
    } else if (!commandName) {
      commandName = arg as CommandName;
    } else {
      throw new CliError(`Unexpected argument: ${arg}`);
    }
  }

  return { commandName, baseUrl, help };
}

async function loginInteractively(client: SeisanClient): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    const email = (await rl.question("Email: ")).trim();
    if (!email) {
      throw new CliError("Email is required.");
    }

    await client.requestLoginCode(email);
    const code = (await rl.question("Verification code: ")).trim();
    if (!/^\d{6}$/u.test(code)) {
      throw new CliError("Verification code must be 6 digits.");
    }

    await client.verifyLoginCode(email, code);
  } finally {
    rl.close();
  }
}

function printHelp(): void {
  console.log(`Usage: pnpm api <command> [--base-url=${DEFAULT_API_BASE_URL}]

Commands:
${Object.entries(commands)
  .map(([name, command]) => `  ${name.padEnd(10)} ${command.description}`)
  .join("\n")}

Options:
  --base-url=<url>  API base URL. Defaults to SEISAN_API_URL or ${DEFAULT_API_BASE_URL}.
  -h, --help        Show this help message.
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
  } else if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
