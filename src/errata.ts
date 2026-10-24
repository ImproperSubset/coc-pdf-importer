// Corrections to a book's content: published errata, and readings of names
// the book misprints. They are the one per-book exception to general parsing
// rules, and correct what a book says, never how the parser reads it.
// A correction applies where the parser reads the printed text, so one a
// later printing fixes simply stops applying, and says so.
import type { CocCharacter } from "./process.ts";
import type { PulpItem } from "./pulp.ts";
import type { OldWestItem } from "./oldwest.ts";
import { sameSpellName, tomeSpellNames } from "./spellmatch.ts";

export interface SpellCorrection {
  /** The spell name as printed in actors' and tomes' spell lists. */
  printed: string;
  corrected: string;
  /** Who says so: an erratum's author and link, or the reading's reason. */
  source: string;
}

// By book: the product code that starts the PDF's file name.
export const CORRECTIONS: Record<string, SpellCorrection[]> = {
  cha23125: [
    {
      printed: "Summon/Bind Formless Spawn",
      corrected: "Contact Formless Spawn",
      source:
        "erratum by the book's co-editor Scott Dorward, https://www.reddit.com/r/callofcthulhu/comments/e0ygwt/",
    },
    {
      printed: "Flesh Warding",
      corrected: "Flesh Ward",
      source: "the importer's reading: the book defines no such spell",
    },
  ],
};

// The book a PDF file name belongs to: its leading product code
// ("cha23125_-_the_two-headed_serpent_v1.2" is "cha23125").
export function bookCode(fileName: string): string {
  return fileName.match(/^[a-z]+\d+/i)?.[0].toLowerCase() ?? "";
}

function errataNote(c: SpellCorrection): string {
  return `Errata: the spell printed as ${c.printed} is ${c.corrected} (${c.source}).`;
}

// Apply a book's corrections to its parsed actors and tomes: a corrected
// spell takes its corrected name in the spell list, and the entry's Keeper
// notes say what was printed. Returns the corrections that applied nowhere.
export function applyCorrections(
  corrections: SpellCorrection[],
  actors: CocCharacter[],
  items: (PulpItem | OldWestItem)[],
): SpellCorrection[] {
  const used = new Set<SpellCorrection>();
  const correct = (name: string, notes: string[]): string => {
    const c = corrections.find((c) => sameSpellName(c.printed, name));
    if (!c) return name;
    used.add(c);
    const note = errataNote(c);
    if (!notes.includes(note)) notes.push(note);
    return c.corrected;
  };
  for (const actor of actors)
    actor.spells = actor.spells.map((s) => correct(s, actor.notes));
  for (const item of items) {
    if (item.kind !== "tome") continue;
    const errata = item.errata ?? [];
    const names = tomeSpellNames(item.spells);
    const corrected = names.map((s) => correct(s, errata));
    if (errata.length) {
      item.errata = errata;
      item.spells = corrected.join(", ");
    }
  }
  return corrections.filter((c) => !used.has(c));
}
