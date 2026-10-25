// Plain words for the update review: what a field is, what a value says, and
// why the module is asking. Pure, so the wording is unit-tested.

import type { Conflict } from "./merge.ts";

const ATTRIBS: Record<string, string> = {
  hp: "Hit points",
  mp: "Magic points",
  san: "Sanity",
  lck: "Luck",
  mov: "Move",
  db: "Damage bonus",
  build: "Build",
  armor: "Armour",
};

const FIELDS: Record<string, string> = {
  name: "Name",
  img: "Portrait",
  "system.description.keeper": "Keeper notes",
  "system.description.value": "Description",
  "system.description.notes": "Notes",
  "system.backstory": "Backstory",
  "system.infos.occupation": "Occupation",
  "system.infos.type": "Type",
  "system.infos.age": "Age",
  "system.special.sanLoss.checkPassed": "Sanity loss (success)",
  "system.special.sanLoss.checkFailled": "Sanity loss (failure)",
  "system.special.attacksPerRound": "Attacks per round",
};

const ITEM_FIELDS: Record<string, string> = {
  "system.value": "value",
  "system.base": "base value",
  "system.adjustments.base": "base value",
  "system.range.normal.damage": "damage",
  "system.range.normal.value": "range",
  "system.usesPerRound.normal": "uses per round",
  "system.bullets": "shots",
  "system.malfunction": "malfunction",
};

// A readable name for a field path ("system.attribs.hp.max" is "Hit points
// (max)"); unknown paths read as their parts.
export function fieldLabel(path: string, itemName?: string | null): string {
  if (itemName) {
    const part = ITEM_FIELDS[path] ?? readablePath(path);
    return `${itemName}: ${part}`;
  }
  if (FIELDS[path]) return FIELDS[path];
  const attrib = /^system\.attribs\.(\w+)\.(value|max)$/.exec(path);
  if (attrib && ATTRIBS[attrib[1]])
    return `${ATTRIBS[attrib[1]]} (${attrib[2] === "max" ? "max" : "current"})`;
  const characteristic = /^system\.characteristics\.(\w+)\.value$/.exec(path);
  if (characteristic) return characteristic[1].toUpperCase();
  if (path.startsWith("prototypeToken.")) return "Token settings";
  return readablePath(path);
}

function readablePath(path: string): string {
  return path
    .replace(/^system\./, "")
    .split(".")
    .map((p) => p.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase())
    .join(" › ");
}

// A value as short plain text.
export function shownValue(value: unknown): string {
  if (value === undefined) return "(not there)";
  if (value === true) return "yes";
  if (value === false) return "no";
  if (value === null || value === "") return "(empty)";
  const text =
    typeof value === "string"
      ? value.replace(/<[^>]*>/g, " ")
      : typeof value === "object" && "name" in (value as object)
        ? String((value as any).name)
        : JSON.stringify(value);
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 157)}…` : flat || "(empty)";
}

// What the conflict is, in a sentence.
export function conflictNote(c: Conflict): string {
  const known = "base" in c;
  if (c.path === null) {
    if (!known)
      return c.pack === undefined
        ? "This item is on the world copy but not in the import. The world copy was edited after its import, with no record of what was loaded, so the module can't tell whether it was added in play."
        : "This item is in the import but not on the world copy. The world copy was edited after its import, with no record of what was loaded, so the module can't tell whether it was removed in play.";
    return c.pack === undefined
      ? "This item was changed in play, and the import no longer has it."
      : "This item was removed in play, and the import changed it.";
  }
  if (!known)
    return "This actor was edited after its import, with no record of what was loaded, so the module can't tell whether play or the import changed this.";
  return `Changed in play and by the import (it was ${shownValue(c.base)} when loaded).`;
}
