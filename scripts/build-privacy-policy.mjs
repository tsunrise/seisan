import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(rootDir, "privacy_policy.md");
const outputPath = resolve(rootDir, "public/privacy_policy.html");

const markdown = await readFile(sourcePath, "utf8");
const html = renderMarkdown(markdown);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${html}\n`, "utf8");

function renderMarkdown(input) {
  const lines = input.replace(/\r\n?/gu, "\n").trim().split("\n");
  const blocks = [];
  let paragraph = [];
  let listItems = [];

  function flushParagraph() {
    if (paragraph.length === 0) {
      return;
    }
    blocks.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  }

  function flushList() {
    if (listItems.length === 0) {
      return;
    }
    blocks.push(
      `<ul>\n${listItems.map((item) => `  <li>${renderInline(item)}</li>`).join("\n")}\n</ul>`,
    );
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
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
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
  return blocks.join("\n\n");
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

  output = output.replace(/\*\*([^*]+)\*\*/gu, (_match, value) =>
    addToken(tokens, `<strong>${escapeHtml(value)}</strong>`),
  );

  output = escapeHtml(output);
  for (const [index, token] of tokens.entries()) {
    output = output.replaceAll(token.placeholder, token.html);
  }
  return output;
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
