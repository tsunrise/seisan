import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const rootDir = resolve(dirname(modulePath), "..");
const sourcePath = resolve(rootDir, "privacy_policy.md");
const outputPath = resolve(rootDir, "public/privacy_policy.html");

export async function buildPrivacyPolicy() {
  const markdown = await readFile(sourcePath, "utf8");
  const html = renderPrivacyPolicy(markdown);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${html}\n`, "utf8");
}

/** Renders the policy as plain HTML: headings (h2+ get anchor ids), paragraphs, and lists. */
export function renderPrivacyPolicy(input) {
  const usedIds = new Map();
  return parseMarkdown(input)
    .map((block) => {
      if (block.type === "heading") {
        let id = "";
        if (block.level > 1) {
          const baseId = slugifyHeading(block.text);
          const seen = usedIds.get(baseId) ?? 0;
          usedIds.set(baseId, seen + 1);
          id = ` id="${escapeAttribute(seen === 0 ? baseId : `${baseId}-${seen + 1}`)}"`;
        }
        return `<h${block.level}${id}>${renderInline(block.text)}</h${block.level}>`;
      }
      if (block.type === "list") {
        return `<ul>\n${block.items.map((item) => `  <li>${renderInline(item)}</li>`).join("\n")}\n</ul>`;
      }
      return `<p>${renderInline(block.text)}</p>`;
    })
    .join("\n\n");
}

export function slugifyHeading(input) {
  const slug = stripHeadingNumber(stripInlineMarkdown(input))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug || "section";
}

function parseMarkdown(input) {
  const lines = input.replace(/\r\n?/gu, "\n").trim().split("\n");
  const blocks = [];
  let paragraph = [];
  let listItems = [];

  function flushParagraph() {
    if (paragraph.length === 0) {
      return;
    }
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  }

  function flushList() {
    if (listItems.length === 0) {
      return;
    }
    blocks.push({ type: "list", items: listItems });
    listItems = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      continue;
    }

    const listItem = /^-\s+(.+)$/u.exec(line);
    if (listItem) {
      flushParagraph();
      listItems.push(listItem[1]);
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  return blocks;
}

function renderInline(input) {
  const tokens = [];
  let output = input.replace(/\[([^\]]+)\]\(([^)\s]+)\)/gu, (_match, label, url) => {
    if (!isSafeUrl(url)) {
      return label;
    }
    return addToken(
      tokens,
      `<a href="${escapeAttribute(url)}"${externalLinkAttributes(url)}>${escapeHtml(label)}</a>`,
    );
  });

  output = output.replace(/`([^`]+)`/gu, (_match, value) =>
    addToken(tokens, `<code>${escapeHtml(value)}</code>`),
  );

  output = output.replace(/\*\*([^*]+)\*\*/gu, (_match, value) =>
    addToken(tokens, `<strong>${escapeHtml(value)}</strong>`),
  );

  output = escapeHtml(output);
  for (const token of tokens) {
    output = output.replaceAll(token.placeholder, token.html);
  }
  return output;
}

function stripInlineMarkdown(input) {
  return input
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .trim();
}

function stripHeadingNumber(input) {
  return input.replace(/^\d+\.\s*/u, "").trim();
}

function addToken(tokens, html) {
  const placeholder = `@@SEISAN_HTML_TOKEN_${tokens.length}@@`;
  tokens.push({ placeholder, html });
  return placeholder;
}

function externalLinkAttributes(url) {
  return url.startsWith("http://") || url.startsWith("https://")
    ? ' target="_blank" rel="noreferrer"'
    : "";
}

function isSafeUrl(url) {
  return url.startsWith("https://") || url.startsWith("http://") || url.startsWith("mailto:");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  await buildPrivacyPolicy();
}
