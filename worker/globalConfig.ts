import { z } from "zod";

import {
  BLOCKED_EMAILS_CONFIG_KEY,
  BlockedEmailsDocumentCodec,
  type BlockedEmailsDocument,
} from "./blockedEmails";
import { CATEGORY_CONFIG_KEY, CategoriesDocumentCodec } from "./category/document";
import { type CategoriesDocument as CategoriesDocumentValue } from "./category/schema";

export const GLOBAL_CONFIG_STORE_NAME = "global-config";

export const GlobalConfigKey = z.enum([CATEGORY_CONFIG_KEY, BLOCKED_EMAILS_CONFIG_KEY]);
export type GlobalConfigKey = z.infer<typeof GlobalConfigKey>;

export interface GlobalConfigValueByKey {
  [CATEGORY_CONFIG_KEY]: CategoriesDocumentValue;
  [BLOCKED_EMAILS_CONFIG_KEY]: BlockedEmailsDocument;
}

export type GlobalConfigValue<K extends GlobalConfigKey> = GlobalConfigValueByKey[K];

interface GlobalConfigCodec<K extends GlobalConfigKey> {
  parseStored(value: string): GlobalConfigValue<K> | null;
  serialize(value: GlobalConfigValue<K>): string;
}

const GlobalConfigValueCodecs = {
  [CATEGORY_CONFIG_KEY]: {
    parseStored(value) {
      return CategoriesDocumentCodec.parseStored(value);
    },
    serialize(value) {
      return CategoriesDocumentCodec.serialize(value);
    },
  },
  [BLOCKED_EMAILS_CONFIG_KEY]: {
    parseStored(value) {
      return BlockedEmailsDocumentCodec.parseStored(value);
    },
    serialize(value) {
      return BlockedEmailsDocumentCodec.serialize(value);
    },
  },
} satisfies { [K in GlobalConfigKey]: GlobalConfigCodec<K> };

export type PublishedGlobalConfigGetResult<K extends GlobalConfigKey> =
  | { ok: true; value: GlobalConfigValue<K> }
  | { ok: false; error: "kv_read_failed" | "not_found" | "invalid_value" };

export class GlobalConfigValueCodec {
  static parseStored<K extends GlobalConfigKey>(
    key: K,
    value: string,
  ): GlobalConfigValue<K> | null {
    const codec = GlobalConfigValueCodecs[key] as GlobalConfigCodec<K>;
    return codec.parseStored(value);
  }

  static serialize<K extends GlobalConfigKey>(key: K, value: GlobalConfigValue<K>): string {
    const codec = GlobalConfigValueCodecs[key] as GlobalConfigCodec<K>;
    return codec.serialize(value);
  }
}

export class PublishedGlobalConfigKvStore {
  static readonly CACHE_TTL_SECONDS = 5 * 60;

  private readonly kv: KVNamespace;

  constructor(kv: KVNamespace) {
    this.kv = kv;
  }

  async getValue<K extends GlobalConfigKey>(key: K): Promise<PublishedGlobalConfigGetResult<K>> {
    let raw: string | null;
    try {
      raw = await this.kv.get(key, {
        cacheTtl: PublishedGlobalConfigKvStore.CACHE_TTL_SECONDS,
      });
    } catch (error) {
      console.error("failed to read published global config", { key, error });
      return { ok: false, error: "kv_read_failed" };
    }

    if (raw === null) {
      return { ok: false, error: "not_found" };
    }

    const value = GlobalConfigValueCodec.parseStored(key, raw);
    if (value === null) {
      return { ok: false, error: "invalid_value" };
    }
    return { ok: true, value };
  }
}
