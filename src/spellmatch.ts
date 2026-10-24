// Matching a tome's printed spell names to spell items. Books name a spell
// loosely: "Contact Yig" for the book's own "Contact Yig (Variant)" or Core
// Content's "Contact Deity: Yig", "Contact Deep Ones" for "Contact Deep One",
// "Shrivelling" for "Shriveling", or one of the spell's alternative names.

// The spell names in a tome's "Spells:" list ("A, B and C."); "none" is none.
export function tomeSpellNames(list: string): string[] {
  return list
    .replace(/\.\s*$/, "")
    .split(/\s*(?:[,;]|\band\b)\s*/)
    .map((s) => s.trim())
    .filter((s) => s && !/^none$/i.test(s));
}

// A loose form of a name: lowercase, apostrophes and punctuation dropped,
// doubled letters single and a final "s" dropped from each word, so spelling
// and plural variants share it.
function looseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((w) => w.replace(/([a-z])\1+/g, "$1").replace(/(?<=..)s$/, ""))
    .join(" ");
}

// The names in a spell's "alternative names" text, when it is a list of names
// ("The Salt Gift, Ye Watery Doom."); prose about naming gives none.
export function alternativeNames(html: string): string[] {
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return [];
  const names = text
    .split(/\s*[,;.]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return names.every((n) => /^[A-Z]/.test(n) && n.split(" ").length <= 10)
    ? names
    : [];
}

// The loose forms a spell answers to: its name, its name without a trailing
// parenthetical ("Contact Yig (Variant)"), a deity spell without "Deity:"
// ("Contact Deity: Yig" as "Contact Yig"), and its alternative names.
function spellForms(name: string, alternatives: string[]): string[] {
  const forms = new Set<string>();
  for (const n of [name, ...alternatives]) {
    const bare = n.replace(/\s*\([^)]*\)\s*$/, "");
    for (const f of [n, bare, bare.replace(/\bDeity:\s*/i, "")])
      if (looseName(f)) forms.add(looseName(f));
  }
  return [...forms];
}

export interface SpellCandidate<T> {
  name: string;
  /** The spell's alternative names. */
  alternatives?: string[];
  value: T;
}

// Finds the one candidate a printed spell name refers to. A name that two
// different spells answer to matches neither.
export class SpellMatcher<T> {
  private byForm = new Map<string, Set<T>>();

  constructor(candidates: SpellCandidate<T>[]) {
    for (const c of candidates) {
      for (const form of spellForms(c.name, c.alternatives ?? [])) {
        const set = this.byForm.get(form) ?? new Set<T>();
        set.add(c.value);
        this.byForm.set(form, set);
      }
    }
  }

  match(name: string): T | undefined {
    const found = this.byForm.get(looseName(name));
    return found?.size === 1 ? [...found][0] : undefined;
  }
}
