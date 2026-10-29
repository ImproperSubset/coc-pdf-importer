// Audit a book's dump for what the parser likely got wrong, as lists to read
// through (tools/audit-checks.ts has the checks). The dump's PDF, when present
// in fixtures/, adds its metadata, its font table, the contents page's
// sections, the write-up headings no actor holds and the group titles whose
// tagline the actor names run in.
//
//   npm run audit -- "<name>"   # out/<name>.json (+ fixtures/<name>.pdf)
//
// Prints to stdout; redirect it to keep a copy.
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
// The legacy build: the modern one calls methods Node lacks (getMetadata
// uses Map.prototype.getOrInsertComputed).
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { importCharacters } from "../src/importer.ts";
import { parseBookSections, printedPageOffset } from "../src/process.ts";
import type { ProcessedDocument } from "../src/process.ts";
import { FIXTURES, OUT } from "./fixtures.ts";
import {
  actorNameIssues,
  attackGaps,
  chapterTally,
  fontTable,
  gluedTaglines,
  groupTables,
  incompleteActors,
  itemIssues,
  pageLines,
  textHeights,
  unheldWriteups,
  unpunctuated,
  weaponNameIssues,
  weaponSkillTally,
  writeupHeadings,
} from "./audit-checks.ts";
import type { Finding, Line } from "./audit-checks.ts";

const arg = process.argv[2];
if (!arg) {
  console.error('usage: npm run audit -- "<name>" (a dump in out/)');
  process.exit(1);
}
const name = path.basename(arg).replace(/\.(?:pdf|json)$/i, "");
const dump: ProcessedDocument = JSON.parse(
  await fs.readFile(path.join(OUT, name + ".json"), "utf8"),
);
const { actors, items } = dump;

const heading = (title: string, count?: number) =>
  console.log(`\n## ${title}${count === undefined ? "" : ` (${count})`}\n`);
const at = (page?: number) => (page ? ` [p. ${page}]` : "");
const list = (title: string, findings: Finding[]) => {
  heading(title, findings.length);
  for (const f of findings)
    console.log(`- ${f.name}${at(f.page)}: ${f.detail}`);
};

console.log(`# Audit: ${name}`);
console.log(`\n${actors.length} actors, ${items.length} items`);

// --- PDF --------------------------------------------------------------------

async function readPdf(file: string) {
  const data = new Uint8Array(await fs.readFile(file));
  const pdf = await pdfjs.getDocument({
    data,
    useSystemFonts: true,
    verbosity: 0,
  }).promise;
  const info = (await pdf.getMetadata()).info as Record<string, unknown>;
  const lines: Line[] = [];
  const pageTexts: string[] = [];
  const realNames = new Map<string, string>();
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const textItems = content.items.map((raw) => {
      const it = raw as {
        str?: string;
        fontName?: string;
        height?: number;
        transform?: number[];
        hasEOL?: boolean;
      };
      return {
        str: it.str ?? "",
        font: it.fontName ?? "",
        height: Math.round((it.height ?? 0) * 10) / 10,
        y: it.transform?.[5] ?? 0,
        eol: it.hasEOL ?? false,
      };
    });
    pageTexts.push(textItems.map((it) => it.str).join(" "));
    lines.push(...pageLines(i, textItems));
    // A font's real name is known once a page using it has its operator
    // list loaded; one page per font is enough.
    const unseen = textItems.some((it) => it.font && !realNames.has(it.font));
    if (unseen) {
      await page.getOperatorList();
      for (const it of textItems)
        if (it.font && !realNames.has(it.font))
          realNames.set(
            it.font,
            page.commonObjs.has(it.font)
              ? ((page.commonObjs.get(it.font) as { name?: string }).name ??
                  it.font)
              : it.font,
          );
    }
  }
  return { pdf, info, lines, pageTexts, realNames };
}

const pdfFile = path.join(FIXTURES, name + ".pdf");
const havePdf = await fs
  .access(pdfFile)
  .then(() => true)
  .catch(() => false);
if (havePdf) {
  const { pdf, info, lines, pageTexts, realNames } = await readPdf(pdfFile);

  heading("PDF metadata");
  console.log(`- Pages: ${pdf.numPages}`);
  for (const key of [
    "Title",
    "Author",
    "Subject",
    "Keywords",
    "Creator",
    "Producer",
    "CreationDate",
    "ModDate",
  ])
    console.log(`- ${key}: ${info[key] ? String(info[key]) : "(none)"}`);

  const heights = textHeights(lines);
  const fonts = fontTable(lines, (id) => realNames.get(id) ?? id);
  heading("Fonts by font and height, most text first", fonts.length);
  console.log(`Body height ${heights.body}, name height ${heights.name}.\n`);
  console.log("| Font | Height | Lines | Chars | Sample |");
  console.log("| --- | --- | --- | --- | --- |");
  for (const r of fonts.slice(0, 40))
    console.log(
      `| ${r.font} | ${r.height} | ${r.lines} | ${r.chars} | ${r.sample.replace(/\|/g, "\\|")} |`,
    );
  if (fonts.length > 40) console.log(`\n(${fonts.length - 40} more rows)`);

  const sections = parseBookSections(pageTexts);
  heading("Sections from the contents page", sections.length);
  console.log(`Printed-page offset: ${printedPageOffset(pageTexts) ?? "none"}`);
  if (!sections.length) console.log("\nNone found.");
  for (const s of sections) console.log(`- ${s.title} [p. ${s.page}]`);

  const headings = writeupHeadings(lines);
  const unheld = unheldWriteups(headings, actors);
  heading(
    `Write-up headings no actor's notes hold (of ${headings.length} found)`,
    unheld.length,
  );
  for (const h of unheld)
    console.log(
      `- ${h.text}${at(h.page)}: ${h.candidates.length ? "near " + h.candidates.slice(0, 4).join("; ") : "no actor shares a name word"}`,
    );

  list(
    "Group titles whose tagline the actor names run in",
    gluedTaglines(lines, actors),
  );
} else {
  console.log(`\n${pdfFile} not found: PDF checks skipped.`);
}

// --- dump -------------------------------------------------------------------

heading("Actors per section");
for (const [chapter, n] of chapterTally(actors))
  console.log(`- ${chapter || "(no section)"}: ${n}`);

list("Notes and backgrounds ending without punctuation", unpunctuated(actors));
list(
  "Actors missing skills, combat, characteristics or HP",
  incompleteActors(actors),
);
list("Attacks with no value or no damage", attackGaps(actors));
list("Weapon names", weaponNameIssues(actors));
list("Actor names", actorNameIssues(actors));
list("Items", itemIssues(items, actors));

const groups = groupTables(actors);
heading("Group tables", groups.length);
for (const g of groups)
  console.log(`- ${g.name}${at(g.page)}: ${g.labels.join(", ")}`);

// --- mock import ------------------------------------------------------------

// Foundry's globals, mocked as src/importer.test.ts does, with no system
// compendia: every weapon takes the skill the importer builds for it.
const created: { name: string; items: any[] }[] = [];
let n = 0;
const g = globalThis as any;
g.game = {
  i18n: { localize: (k: string) => k, format: (k: string) => k, lang: "en" },
  folders: { find: () => undefined, filter: () => [] },
  actors: { filter: () => [] },
  items: { filter: () => [] },
  settings: { registerMenu() {} },
};
g.ui = { notifications: { info() {}, warn() {}, error() {} } };
g.Folder = {
  create: async (d: any) => ({ id: "f" + ++n, ...d, update: async () => {} }),
};
g.Actor = {
  create: async (d: any, opts?: { keepId?: boolean }) => {
    const a: any = {
      ...d,
      id: opts?.keepId && d._id ? d._id : "a" + ++n,
      items: [],
    };
    a.createEmbeddedDocuments = async (
      _type: string,
      docs: any[],
      o?: { keepId?: boolean },
    ) => {
      const withIds = docs.map((doc) => {
        const id = o?.keepId && doc._id ? doc._id : "i" + ++n;
        return { ...doc, _id: id, id };
      });
      a.items.push(...withIds);
      return withIds;
    };
    a.update = async () => {};
    a.toObject = () => ({ ...d, _id: a.id });
    created.push(a);
    return a;
  },
};
const result = await importCharacters(structuredClone(actors), {
  notify: false,
});
const tally = weaponSkillTally(created);
heading(
  `Weapon skills after a mock import (${result.created} actors, ${result.failed} failed)`,
  tally.length,
);
for (const r of tally)
  console.log(
    `- ${r.skill || "(no skill)"} [${r.kind}]: ${r.weapons} — ${r.examples.join("; ")}`,
  );
