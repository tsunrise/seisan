import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { renderPrivacyPolicy, slugifyHeading } from "./build-privacy-policy.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("slugifyHeading creates stable, readable anchors", () => {
  assert.equal(
    slugifyHeading("10. Cookies, local storage, and tracking"),
    "cookies-local-storage-and-tracking",
  );
  assert.equal(slugifyHeading("Café & privacy"), "cafe-privacy");
  assert.equal(slugifyHeading("***"), "section");
});

test("renderPrivacyPolicy renders plain HTML with anchored section headings", () => {
  const html = renderPrivacyPolicy(`# Privacy

Intro.

## 1. At a glance

- One
- Two

## 2. Details

Text.

## 3. Details

More text.`);

  assert.match(html, /^<h1>Privacy<\/h1>/u);
  assert.match(html, /<p>Intro\.<\/p>/u);
  assert.match(html, /<h2 id="at-a-glance">1\. At a glance<\/h2>/u);
  assert.match(html, /<ul>\n {2}<li>One<\/li>\n {2}<li>Two<\/li>\n<\/ul>/u);
  assert.match(html, /id="details"/u);
  assert.match(html, /id="details-2"/u);
  assert.doesNotMatch(html, /<nav|<section|<article/u);
});

test("renderPrivacyPolicy escapes text and allows only safe links", () => {
  const html = renderPrivacyPolicy(`# Privacy <script>

## Links

[Safe](https://example.com?a=1&b=2) [Mail](mailto:privacy@example.com) [Unsafe](javascript:alert(1)) **<strong>** \`<script>code</script>\``);

  assert.doesNotMatch(html, /<script>/u);
  assert.match(html, /Privacy &lt;script&gt;/u);
  assert.match(
    html,
    /href="https:\/\/example\.com\?a=1&amp;b=2" target="_blank" rel="noreferrer"/u,
  );
  assert.match(html, /href="mailto:privacy@example\.com"/u);
  assert.doesNotMatch(html, /javascript:/u);
  assert.match(html, /<strong>&lt;strong&gt;<\/strong>/u);
  assert.match(html, /<code>&lt;script&gt;code&lt;\/script&gt;<\/code>/u);
});

test("privacy map references existing files and covers every public policy section", async () => {
  const [policy, privacyMap] = await Promise.all([
    readFile(resolve(rootDir, "privacy_policy.md"), "utf8"),
    readFile(resolve(rootDir, "docs/privacy.md"), "utf8"),
  ]);
  const sectionIds = [...policy.matchAll(/^##\s+(.+)$/gmu)].map((match) =>
    slugifyHeading(match[1]),
  );
  for (const sectionId of sectionIds) {
    assert.match(
      privacyMap,
      new RegExp(`\\[#${sectionId}\\]`, "u"),
      `missing map entry for #${sectionId}`,
    );
  }

  const pathPattern =
    /`((?:(?:src|worker|scripts|docs|shared|public)\/[^`]+\.[a-z]+)|(?:AGENTS\.md|package\.json|privacy_policy\.md|wrangler\.jsonc))`/gu;
  const referencedPaths = [...privacyMap.matchAll(pathPattern)].map((match) => match[1]);
  assert.ok(referencedPaths.length > 0, "expected privacy map file references");
  for (const referencedPath of new Set(referencedPaths)) {
    await assert.doesNotReject(
      readFile(resolve(rootDir, referencedPath)),
      `privacy map references missing file ${referencedPath}`,
    );
  }
});
