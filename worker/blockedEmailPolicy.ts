import {
  BLOCKED_EMAILS_CONFIG_KEY,
  testBlockedEmail,
  type BlockedEmailTestResult,
} from "./blockedEmails";
import { normalizeEmail } from "./email";
import { PublishedGlobalConfigKvStore } from "./globalConfig";

export class PublishedBlockedEmailPolicy {
  private readonly store: PublishedGlobalConfigKvStore;

  constructor(kv: KVNamespace) {
    this.store = new PublishedGlobalConfigKvStore(kv);
  }

  async test(email: string): Promise<BlockedEmailTestResult> {
    const normalizedEmail = normalizeEmail(email);
    const published = await this.store.getValue(BLOCKED_EMAILS_CONFIG_KEY);
    if (!published.ok) {
      if (published.error === "invalid_value") {
        console.error("invalid published blocked email config");
      }
      return { email: normalizedEmail, blocked: false, matchedPattern: null };
    }

    return testBlockedEmail(published.value, normalizedEmail);
  }
}
