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

export function renderPrivacyPolicy(input) {
  const blocks = parseMarkdown(input);
  const usedIds = new Map();
  const headings = [];

  for (const block of blocks) {
    if (block.type !== "heading") {
      continue;
    }
    const baseId = block.level === 1 ? "privacy-policy-title" : slugifyHeading(block.text);
    const seen = usedIds.get(baseId) ?? 0;
    usedIds.set(baseId, seen + 1);
    block.id = seen === 0 ? baseId : `${baseId}-${seen + 1}`;
    if (block.level === 2) {
      headings.push({ id: block.id, text: stripHeadingNumber(block.text) });
    }
  }

  const firstSectionIndex = blocks.findIndex(
    (block) => block.type === "heading" && block.level === 2,
  );
  const headerBlocks = firstSectionIndex === -1 ? blocks : blocks.slice(0, firstSectionIndex);
  const sectionBlocks = firstSectionIndex === -1 ? [] : blocks.slice(firstSectionIndex);
  const sections = groupSections(sectionBlocks);
  const title = blocks.find((block) => block.type === "heading" && block.level === 1);
  const labelledBy = title?.id ? ` aria-labelledby="${escapeAttribute(title.id)}"` : "";

  return [
    `<article class="privacy-policy"${labelledBy}>`,
    `  <header class="privacy-policy__header">\n${indent(renderBlocks(headerBlocks), 4)}\n  </header>`,
    '  <div class="privacy-policy__layout">',
    renderTableOfContents(headings),
    '    <div class="privacy-policy__sections" id="privacy-policy-content">',
    sections.map(renderSection).join("\n\n"),
    "    </div>",
    "  </div>",
    "</article>",
  ].join("\n");
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

function groupSections(blocks) {
  const sections = [];
  let current = null;

  for (const block of blocks) {
    if (block.type === "heading" && block.level === 2) {
      current = { id: block.id, blocks: [block] };
      sections.push(current);
      continue;
    }
    if (current) {
      current.blocks.push(block);
    }
  }
  return sections;
}

function renderTableOfContents(headings) {
  const items = headings
    .map(
      (heading) =>
        `          <li><a href="#${escapeAttribute(heading.id)}">${renderInline(heading.text)}</a></li>`,
    )
    .join("\n");
  return [
    '    <details class="privacy-policy__toc" open>',
    `      <summary>On this page <span>${headings.length} sections</span></summary>`,
    '      <nav aria-label="Privacy policy sections">',
    "        <ol>",
    items,
    "        </ol>",
    "      </nav>",
    "    </details>",
  ].join("\n");
}

function renderSection(section) {
  const modifier = section.id === "at-a-glance" ? " privacy-policy__section--summary" : "";
  return [
    `      <section class="privacy-policy__section${modifier}" aria-labelledby="${escapeAttribute(section.id)}">`,
    indent(renderBlocks(section.blocks), 8),
    "      </section>",
  ].join("\n");
}

function renderBlocks(blocks) {
  return blocks
    .map((block) => {
      if (block.type === "heading") {
        const id = block.id ? ` id="${escapeAttribute(block.id)}"` : "";
        return `<h${block.level}${id}>${renderInline(block.text)}</h${block.level}>`;
      }
      if (block.type === "list") {
        return `<ul>\n${block.items.map((item) => `  <li>${renderInline(item)}</li>`).join("\n")}\n</ul>`;
      }
      return `<p>${renderInline(block.text)}</p>`;
    })
    .join("\n\n");
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

function indent(value, spaces) {
  const prefix = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => (line === "" ? "" : `${prefix}${line}`))
    .join("\n");
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
