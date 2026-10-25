// Art for imported creatures from the system's own creatures (Core Content's
// "Dhole", "Ghoul", …): the book's stat block stays the source of the actor;
// only the portrait and token image come from the match.

export interface CreatureArt {
  img: string;
  token: string;
}

// A system default icon, which the art of a matched creature replaces.
export function isDefaultArt(path: string | null | undefined): boolean {
  return (
    !path ||
    path.startsWith("systems/CoC7/assets/icons/") ||
    path.startsWith("icons/svg/")
  );
}

// A loose form of a creature's name: lowercase, apostrophes and punctuation
// dropped, a parenthetical and a leading "The" dropped, and a final "s" off
// each word, so "The Giant Snakes" and "Giant Snake (Constrictor)" share it.
function looseName(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => w.replace(/(?<=...)s$/, ""));
  if (words[0] === "the") words.shift();
  return words.join(" ");
}

// Finds a creature's art by its name: the same name, loosely, or the system
// creature's name with a qualifier ("Formless Spawn of Tsathoggua" is
// "Formless Spawn").
export class CreatureArtMatcher {
  private byName = new Map<string, CreatureArt>();

  constructor(creatures: { name: string; img?: string; token?: string }[]) {
    for (const c of creatures) {
      if (isDefaultArt(c.img)) continue;
      const key = looseName(c.name);
      if (key && !this.byName.has(key))
        this.byName.set(key, {
          img: c.img!,
          token: isDefaultArt(c.token) ? c.img! : c.token!,
        });
    }
  }

  match(name: string): CreatureArt | undefined {
    const key = looseName(name);
    const exact = this.byName.get(key);
    if (exact) return exact;
    const of = key.indexOf(" of ");
    return of > 0 ? this.byName.get(key.slice(0, of)) : undefined;
  }
}
