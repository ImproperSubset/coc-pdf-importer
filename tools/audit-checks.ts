// The audit's checks (tools/audit.ts): pure functions over a dump's actors and
// items, the PDF's text lines, and the actors a mock import creates. Each
// returns the entries worth a look; the CLI prints them.
import type { CocCharacter, ProcessedDocument } from "../src/process.ts";

type Item = ProcessedDocument["items"][number];

// --- PDF text ---------------------------------------------------------------

// One line of a page's text: items on one baseline, in the font and height of
// its first item.
export interface Line {
  page: number;
  y: number;
  font: string;
  height: number;
  text: string;
}

export interface TextItem {
  str: string;
  font: string;
  height: number;
  y: number;
  eol: boolean;
}

// A page's items as lines: an item continues the line when it sits on the
// same baseline and no end-of-line came before it.
export function pageLines(page: number, items: TextItem[]): Line[] {
  const lines: Line[] = [];
  let line: Line | null = null;
  let broken = true;
  for (const it of items) {
    if (it.str.trim()) {
      if (!line || broken || Math.abs(it.y - line.y) > 1) {
        line = { page, y: it.y, font: it.font, height: it.height, text: "" };
        lines.push(line);
      }
      line.text = (line.text + " " + it.str).replace(/\s+/g, " ").trim();
      broken = false;
    }
    if (it.eol) broken = true;
  }
  return lines;
}

function modeOf(values: number[]): number | undefined {
  const tally = new Map<number, number>();
  for (const v of values) tally.set(v, (tally.get(v) ?? 0) + 1);
  let best: number | undefined;
  let count = 0;
  for (const [v, c] of tally) if (c > count) [best, count] = [v, c];
  return best;
}

// Body height: the most common line height. Name height: the most common
// height above it among lines that are not page furniture (page numbers, a
// text printed eight or more times: running headers, drop capitals), as the
// parser reads NPC names.
export function textHeights(lines: Line[]): { body: number; name: number } {
  const body = modeOf(lines.map((l) => l.height)) ?? 0;
  const above = lines.filter((l) => l.height > body);
  const repeats = new Map<string, number>();
  for (const l of above) repeats.set(l.text, (repeats.get(l.text) ?? 0) + 1);
  const name = modeOf(
    above
      .filter((l) => repeats.get(l.text)! < 8 && !/^[\d ]+$/.test(l.text))
      .map((l) => l.height),
  );
  return { body, name: name ?? 0 };
}

export interface FontRow {
  font: string; // the font's real name, or its pdf.js id when unknown
  height: number;
  lines: number;
  chars: number;
  sample: string;
}

// Lines tallied by font and height, most text first.
export function fontTable(
  lines: Line[],
  realName: (id: string) => string = (id) => id,
): FontRow[] {
  const rows = new Map<string, FontRow>();
  for (const l of lines) {
    const font = realName(l.font);
    const key = `${font}\u0000${l.height}`;
    const row = rows.get(key) ?? {
      font,
      height: l.height,
      lines: 0,
      chars: 0,
      sample: l.text.slice(0, 50),
    };
    row.lines++;
    row.chars += l.text.length;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.chars - a.chars);
}

// Letters and digits only, lowercased: how headings and notes are compared,
// since the parser's spacing ("Ada Lark , 40") and quotes differ from the
// PDF's.
const loose = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();

export interface Heading {
  page: number;
  text: string;
}

// Write-up headings: a run of name-height lines ("Ada Lark, 40,", "lamp
// keeper") holding a comma, whose body text up to the next taller line has a
// "• Link:" or "• Description:" bullet.
export function writeupHeadings(lines: Line[]): Heading[] {
  const { body, name } = textHeights(lines);
  if (!name) return [];
  const isName = (l: Line) => Math.abs(l.height - name) < 0.5;
  const out: Heading[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isName(lines[i])) continue;
    let j = i;
    const parts: string[] = [];
    while (j < lines.length && isName(lines[j])) parts.push(lines[j++].text);
    const page = lines[i].page;
    i = j - 1;
    const text = parts.join(" ");
    if (!text.includes(",")) continue;
    let following = "";
    for (let k = j; k < lines.length && following.length < 3000; k++) {
      if (lines[k].height > body + 0.5) break;
      following += " " + lines[k].text;
    }
    if (/•\s*(?:Link|Description)\s*:/i.test(following))
      out.push({ page, text });
  }
  return out;
}

// Headings no actor's notes open with (each note the parser attaches starts
// with its heading), each with the actors sharing a word of its name's last
// two ("Ada Lark" for "Mrs. Ada Hope Lark"): the stat block it likely
// belongs to, if any.
const TITLES = new Set(["mr", "mrs", "ms", "dr", "st", "lt", "the", "of"]);

export function unheldWriteups(
  headings: Heading[],
  actors: CocCharacter[],
): (Heading & { candidates: string[] })[] {
  const held = actors.flatMap((a) =>
    a.notes.map((n) => loose(n.split("\n\n")[0])),
  );
  const words = (s: string) =>
    s
      .split(/[\s()]+/)
      .map(loose)
      .filter((w) => w.length > 1 && !TITLES.has(w));
  return headings
    .filter((h) => {
      const name = loose(h.text.slice(0, h.text.indexOf(",")));
      return !held.some((n) => n.startsWith(name));
    })
    .map((h) => {
      const last = words(h.text.slice(0, h.text.indexOf(","))).slice(-2);
      const candidates = actors
        .map((a) => a.name)
        .filter((n, i, all) => all.indexOf(n) === i)
        .filter((n) => words(n).some((w) => last.includes(w)));
      return { ...h, candidates };
    });
}

// --- actors -----------------------------------------------------------------

const ENDS_SENTENCE = /[.!?:;)”"’]\s*$/;

export interface Finding {
  name: string;
  page?: number;
  detail: string;
}

const where = (a: { name: string; page?: number }) => ({
  name: a.name,
  page: a.page,
});

// Notes ending without punctuation; background sections likewise, when they
// hold a sentence break (a single phrase, "green eyes", is the book's style).
export function unpunctuated(actors: CocCharacter[]): Finding[] {
  const out: Finding[] = [];
  for (const a of actors) {
    a.notes.forEach((n, i) => {
      if (n.trim() && !ENDS_SENTENCE.test(n))
        out.push({ ...where(a), detail: `note ${i + 1}: …${n.slice(-60)}` });
    });
    for (const b of a.background)
      if (/[.!?]\s/.test(b.text) && !ENDS_SENTENCE.test(b.text))
        out.push({ ...where(a), detail: `${b.title}: …${b.text.slice(-60)}` });
  }
  return out;
}

const HUMAN_CHARS = ["STR", "CON", "SIZ", "DEX", "INT", "APP", "POW", "EDU"];
const CREATURE_CHARS = ["STR", "CON", "SIZ", "DEX", "INT", "POW"];

// Actors missing a part of their stat block: skills, combat, a characteristic
// (APP and EDU only for actors without a Sanity loss line), or HP. A value the
// book prints as none ("—", "n/a": a ghost's STR) is not missing.
export function incompleteActors(actors: CocCharacter[]): Finding[] {
  const out: Finding[] = [];
  const absent = (a: CocCharacter, c: string) => {
    const v = a.characteristics[c as keyof typeof a.characteristics];
    return v?.value == null && !/^(?:[-—–]|n\/a)\*?$/i.test(v?.raw ?? "");
  };
  for (const a of actors) {
    const gaps: string[] = [];
    if (!Object.keys(a.skills).length) gaps.push("no skills");
    if (!a.combat.length) gaps.push("no combat");
    const wanted = a.sanityLoss ? CREATURE_CHARS : HUMAN_CHARS;
    const missing = wanted.filter((c) => absent(a, c));
    if (missing.length) gaps.push("missing " + missing.join(" "));
    if (absent(a, "HP")) gaps.push("no HP");
    if (gaps.length) out.push({ ...where(a), detail: gaps.join("; ") });
  }
  return out;
}

const NO_DAMAGE_EXPECTED = /^dodge$|\bmnvr\b|manoeuvre|maneuver/i;

// Attacks with no value, or no damage where one is expected (not Dodge or a
// manoeuvre).
export function attackGaps(actors: CocCharacter[]): Finding[] {
  const out: Finding[] = [];
  for (const a of actors)
    for (const c of a.combat) {
      const gaps: string[] = [];
      if (c.value == null) gaps.push("no value");
      if (!c.damage && !NO_DAMAGE_EXPECTED.test(c.name)) gaps.push("no damage");
      if (gaps.length)
        out.push({ ...where(a), detail: `${c.name}: ${gaps.join(", ")}` });
    }
  return out;
}

// What looks wrong in a printed name: characters outside a name's usual set,
// spacing (doubled, before punctuation, inside quotes), a lone letter split
// off a word ("Rifl e"), or a skill word glued to its end.
export function nameOddities(name: string): string[] {
  const out: string[] = [];
  if (/[^\p{L}\p{N} '’"“”().,\-/&:!?]/u.test(name)) out.push("odd characters");
  if (/\s{2,}|^\s|\s$/.test(name)) out.push("odd spacing");
  if (
    /\s[,;:!?)]|\s\.(?!\d)|\(\s|["“]\s+\S+\s+["”]|\S\s+["”](?:\s|$)/.test(name)
  )
    out.push("space before punctuation or inside quotes");
  if (/\p{Ll}{2,} \p{Ll}\b(?![’'])/u.test(name)) out.push("split word");
  if (/\s(?:Fighting|Firearms|Brawl)$/.test(name))
    out.push("skill word at end");
  return out;
}

// Actor names: oddities, all-capital or lowercase words, a short title-case
// parenthetical (an acronym the parser recased: "(Nyc)"), and names printed
// more than once. A group table's columns are checked once, by the group's
// name.
export function actorNameIssues(actors: CocCharacter[]): Finding[] {
  const out: Finding[] = [];
  const count = new Map<string, number>();
  for (const a of actors) count.set(a.name, (count.get(a.name) ?? 0) + 1);
  const columns = new Map<string, Group>();
  for (const g of groupTables(actors))
    for (const l of g.labels) columns.set(`${g.name} ${l}`, g);
  const reported = new Set<string>();
  for (const a of actors) {
    const group = columns.get(a.name);
    const name = group?.name ?? a.name;
    if (reported.has(name)) continue;
    reported.add(name);
    const issues = nameOddities(name);
    const words = name
      .replace(/\([^)]*\)/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    if (words.some((w) => /^\p{Lu}{2,}$/u.test(w) && !/^[IVX]+$/.test(w)))
      issues.push("all-capital word");
    if (/^\p{Ll}/u.test(name)) issues.push("lowercase start");
    if (/\(\p{Lu}\p{Ll}{1,2}\)/u.test(name))
      issues.push("short title-case parenthetical (an acronym?)");
    if (!group && (count.get(name) ?? 0) > 1)
      issues.push(`printed ${count.get(name)} times`);
    if (issues.length)
      out.push({
        name: group ? `${name} (group)` : name,
        page: a.page,
        detail: issues.join("; "),
      });
  }
  return out;
}

// Group titles printed with a tagline after a comma ("GRUE, HUNGRY
// NIGHT-STALKERS") whose actors' names run the tagline in ("Grue Hungry
// Night-Stalkers 1"), one finding per title.
export function gluedTaglines(
  lines: Line[],
  actors: CocCharacter[],
): Finding[] {
  const { body } = textHeights(lines);
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    if (l.height <= body || seen.has(l.text)) continue;
    const comma = l.text.indexOf(",");
    if (comma <= 0) continue;
    const head = loose(l.text.slice(0, comma));
    const glued = head + loose(l.text.slice(comma + 1));
    if (glued === head) continue;
    // A parenthesized tagline is the parser's own qualifier ("Ssathasaa (as
    // Bertha Shipley)").
    const hits = actors.filter((a) =>
      loose(a.name.replace(/\s*\(.*$/, "")).startsWith(glued),
    );
    if (!hits.length) continue;
    seen.add(l.text);
    out.push({
      name: hits[0].name,
      page: l.page,
      detail: `heading "${l.text}"; ${hits.length} actor(s)`,
    });
  }
  return out;
}

// Weapon names with oddities.
export function weaponNameIssues(actors: CocCharacter[]): Finding[] {
  const out: Finding[] = [];
  for (const a of actors)
    for (const c of a.combat) {
      const issues = nameOddities(c.name);
      if (issues.length)
        out.push({ ...where(a), detail: `${c.name}: ${issues.join("; ")}` });
    }
  return out;
}

export interface Group {
  name: string;
  page?: number;
  labels: string[];
}

// Group tables: consecutive actors whose names differ only in their last
// word, the column label ("Grue 1", "Grue 2"; "Squad A1"; "Dogs Rex"), and
// whose notes are the same (each column copies the table's). A repeated
// name is a duplicate, not a column.
export function groupTables(actors: CocCharacter[]): Group[] {
  const out: Group[] = [];
  const split = (name: string) => {
    const at = name.lastIndexOf(" ");
    return at < 0 ? null : [name.slice(0, at), name.slice(at + 1)];
  };
  let group: Group | null = null;
  let notes = "";
  for (const a of actors) {
    const parts = split(a.name);
    const same = JSON.stringify(a.notes) === notes;
    notes = JSON.stringify(a.notes);
    if (
      group &&
      parts &&
      parts[0] === group.name &&
      same &&
      !group.labels.includes(parts[1])
    ) {
      group.labels.push(parts[1]);
      continue;
    }
    if (group && group.labels.length > 1) out.push(group);
    group = parts ? { name: parts[0], page: a.page, labels: [parts[1]] } : null;
  }
  if (group && group.labels.length > 1) out.push(group);
  return out;
}

// Actors per book section; "" is an actor in no section.
export function chapterTally(actors: CocCharacter[]): Map<string, number> {
  const tally = new Map<string, number>();
  for (const a of actors)
    tally.set(a.chapter ?? "", (tally.get(a.chapter ?? "") ?? 0) + 1);
  return tally;
}

// --- items ------------------------------------------------------------------

// Items with an empty description, and items whose name runs another known
// name into more words ("Fog Sign Book of Mist", where "Fog Sign" is a spell
// an actor or a tome lists): two entries merged into one.
export function itemIssues(items: Item[], actors: CocCharacter[]): Finding[] {
  const known = new Set<string>();
  for (const i of items) known.add(i.name);
  for (const a of actors) for (const s of a.spells) known.add(s);
  for (const i of items) {
    const spells = (i as { spells?: unknown }).spells;
    if (typeof spells === "string")
      for (const s of spells.split(/[,;]/)) known.add(s.trim());
  }
  const out: Finding[] = [];
  for (const i of items) {
    const issues: string[] = [];
    const description = (i as { description?: unknown }).description;
    if (typeof description !== "string" || !description.trim())
      issues.push("empty description");
    const merged = [...known].find(
      (k) =>
        k.length >= 4 &&
        k !== i.name &&
        ((i.name.startsWith(k + " ") &&
          !/^\s*\([^)]*\)$/.test(i.name.slice(k.length))) ||
          i.name.endsWith(" " + k)),
    );
    if (merged) issues.push(`name runs "${merged}" into more words`);
    if (issues.length)
      out.push({
        name: `${i.name} (${i.kind})`,
        page: i.page,
        detail: issues.join("; "),
      });
  }
  return out;
}

// --- mock import ------------------------------------------------------------

// The category skills the importer gives weapons it matches to no compendium
// weapon; any other weapon skill is the weapon's own.
const CATEGORY_SKILLS = new Set([
  "Fighting (Brawl)",
  "Fighting (Fighting)",
  "Fighting (Sword)",
  "Fighting (Axe)",
  "Fighting (Spear)",
  "Fighting (Whip)",
  "Fighting (Garrote)",
  "Fighting (Chainsaw)",
  "Fighting (Flail)",
  "Firearms (Handgun)",
  "Firearms (Rifle/Shotgun)",
  "Firearms (Submachine Gun)",
  "Firearms (Machine Gun)",
  "Firearms (Bow)",
  "Throw",
]);

export interface SkillRow {
  skill: string; // "" for a weapon linked to no skill
  kind: "category" | "per-weapon" | "none";
  weapons: number;
  examples: string[]; // "Actor: Weapon"
}

// Weapons of the actors a mock import created, tallied by the skill each one
// links (`system.skill.main.name`).
export function weaponSkillTally(
  created: { name: string; items: any[] }[],
): SkillRow[] {
  const rows = new Map<string, SkillRow>();
  for (const a of created)
    for (const w of a.items.filter((i) => i.type === "weapon")) {
      const skill: string = w.system?.skill?.main?.name ?? "";
      const row = rows.get(skill) ?? {
        skill,
        kind: !skill
          ? "none"
          : CATEGORY_SKILLS.has(skill)
            ? "category"
            : "per-weapon",
        weapons: 0,
        examples: [],
      };
      row.weapons++;
      if (row.examples.length < 4) row.examples.push(`${a.name}: ${w.name}`);
      rows.set(skill, row);
    }
  const order = { none: 0, "per-weapon": 1, category: 2 };
  return [...rows.values()].sort(
    (a, b) => order[a.kind] - order[b.kind] || b.weapons - a.weapons,
  );
}
