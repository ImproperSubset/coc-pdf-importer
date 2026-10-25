// The Foundry world-import layer. process.ts turns a PDF into { actors, items }
// without touching Foundry, where items are internal PulpItem structures. This
// module maps those to Foundry item documents — resolving skill names to CoCIDs
// and shaping the system data — and creates them (actors go via importer.ts).
// importDocument ties the two together so callers (the UI, the dump tool) deal
// with a single call.
import { processPDF } from "./process.ts";
import { ensureBookFolder } from "./folders.ts";
import { boldLabelHtml, loadSpellIndex, loadWeaponIndex } from "./importer.ts";
import { SpellMatcher, indexedSpells, tomeSpellNames } from "./spellmatch.ts";
import type { SpellCandidate } from "./spellmatch.ts";
import type { SourcePage } from "./process.ts";
import {
  bookTitleFromFileName,
  citationHtml,
  sourceCitation,
} from "./citation.ts";
import { importCharacters } from "./importer.ts";
import type { ImportResult } from "./importer.ts";
import { claimReplaced, createReplacing } from "./replace.ts";
import type { PulpItem, PulpTalent, PulpArchetype } from "./pulp.ts";
import type {
  AppendixSpell,
  AppendixTome,
  AppendixArtefact,
} from "./appendix.ts";
import type {
  OldWestItem,
  OldWestOccupation,
  OldWestSkill,
  OldWestWeapon,
  OldWestSpell,
} from "./oldwest.ts";

// --- Foundry item documents from parsed items ------------------------------

// The talent item's category flags (basic/insane/other exist in the schema but
// are left false for player talents).
const TALENT_TYPE_FLAGS = [
  "physical",
  "mental",
  "combat",
  "miscellaneous",
  "basic",
  "insane",
  "other",
] as const;
const CORE_CHARS = ["str", "con", "siz", "dex", "app", "int", "pow", "edu"];

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Each part as one or more <p> paragraphs: a blank line ("\n\n", marked by the
// parser where the book starts a paragraph) separates paragraphs within a part;
// a bullet's label is bold.
function paragraphs(parts: string[]): string {
  return parts
    .flatMap((p) => (p ?? "").split(/\n{2,}/))
    .filter((p) => p.trim())
    .map((p) => `<p>${boldLabelHtml(p.trim())}</p>`)
    .join("");
}

// A talent's or archetype's description: unwrapped escaped text, as the
// system's own items store it, unless it has paragraphs.
function descriptionHtml(text: string): string {
  return /\n{2,}/.test(text) ? paragraphs([text]) : escapeHtml(text);
}

// Resolve a skill name to its CoCID, mirroring CoC7Utilities.toKebabCase so
// "Fighting (Brawl)" -> "i.skill.fighting-brawl" matches what the system stores.
function skillCocid(name: string): string {
  const m = (name ?? "").match(
    /[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g,
  );
  return "i.skill." + (m ? m.join("-").toLowerCase() : "");
}

// A CoC7 "talent" item document (schema per E:/export_trait.json). No `img`: the
// icon isn't source data, so it's assigned at creation. The description carries
// only the (escaped) source text, unwrapped — as the actor importer does.
function talentDoc(t: PulpTalent, source: string): any {
  const type = Object.fromEntries(
    TALENT_TYPE_FLAGS.map((flag) => [flag, flag === t.category]),
  );
  return {
    name: t.name,
    type: "talent",
    system: {
      source,
      description: {
        value: descriptionHtml(t.description),
        notes: "",
        keeper: "",
      },
      type,
      adjustments: [],
    },
  };
}

// A CoC7 "archetype" item document (schema per E:/export_archetype.json). The
// bonus-point skill names are resolved to CoCID itemKeys here, at import.
function archetypeDoc(a: PulpArchetype, source: string): any {
  const coreCharacteristics = Object.fromEntries(
    CORE_CHARS.map((c) => [c, a.coreCharacteristics.includes(c)]),
  );
  return {
    name: a.name,
    type: "archetype",
    system: {
      description: { value: descriptionHtml(a.description), keeper: "" },
      source,
      bonusPoints: a.bonusPoints,
      coreCharacteristics,
      coreCharacteristicsFormula: { enabled: true, value: "(1D6+13)*5" },
      suggestedOccupations: escapeHtml(a.suggestedOccupations.join(", ")),
      suggestedTraits: escapeHtml(a.suggestedTraits.join(", ")),
      talents: a.talents,
      itemDocuments: [],
      itemKeys: a.skills.map(skillCocid),
    },
  };
}

// A cost the spell sheet can deduct: a number or dice expression ("5",
// "1D6 + 4").
const COST_FORMULA = /^\d+(?:[dD]\d+)?(?:\s*[+-]\s*\d+(?:[dD]\d+)?)*$/;

// The legacy cost fields in the order Core Content's spells list their
// costs, with the cost list's key for each.
const COST_KEYS = [
  ["magicPoints", "mp"],
  ["power", "pow"],
  ["sanity", "san"],
  ["hitPoints", "hp"],
] as const;

// A spell's cost list, as Core Content's spells store their costs: one caster
// cost per deductible cost, the printed Cost line as information when any
// part of it is not deductible ("4+ magic points", "per round"), and a rolled
// casting time ("1D6 + 4 rounds" sets @rounds and shows "@rounds rounds").
function spellCostList(s: AppendixSpell | OldWestSpell): any[] {
  const list: any[] = [];
  let partial = s.costs.others !== "";
  for (const [field, key] of COST_KEYS) {
    const value = s.costs[field];
    if (!value) continue;
    if (!COST_FORMULA.test(value)) {
      partial = true;
      continue;
    }
    list.push({
      type: "casterCost",
      if: "",
      config: JSON.stringify({ modify: key, value: value.toUpperCase() }),
    });
  }
  if (partial && s.cost)
    list.push({
      type: "additionalInformation",
      if: "",
      config: JSON.stringify({ prompt: `Cost: ${s.cost}` }),
    });
  const time = s.castingTime.match(
    /^(\d*[dD]\d+(?:\s*[+-]\s*\d+(?:[dD]\d+)?)*)\s+((rounds?|minutes?|hours?|days?)\b.*)$/i,
  );
  if (time) {
    const unit = time[3].toLowerCase().replace(/s?$/, "s");
    list.push(
      {
        type: "setVariable",
        if: "",
        config: JSON.stringify({
          variable: `@${unit}`,
          value: time[1].toUpperCase(),
        }),
      },
      {
        type: "castingTime",
        if: "",
        config: JSON.stringify({ value: `@${unit} ${time[2]}` }),
      },
    );
  }
  return list;
}

// The spell types a spell's name states, as Core Content sets them ("Contact
// Deity: Yig" is a Contact spell, "Summon/Bind Byakhee" both Summon and Bind).
function spellTypes(name: string): Record<string, boolean> {
  return {
    bind: /^(?:Summon\s*\/\s*)?Bind\b/i.test(name),
    call: /^Call\b/i.test(name),
    combat: false,
    contact: /^Contact\b/i.test(name),
    dismiss: /^Dismiss\b/i.test(name),
    enchantment: false,
    gate: /\bGates?\b/i.test(name),
    summon: /^Summon\b/i.test(name),
  };
}

// A spell item: the description, the printed casting time, the spell types its
// name states, and its costs as a cost list (spellCostList). The legacy cost
// fields stay empty once the cost list holds the costs, as in Core Content's
// spells and the system's migration of older ones. Shared by Chaosium-appendix
// spells (AppendixSpell) and Down Darker Trails' identically-shaped spells
// (OldWestSpell).
function spellDoc(s: AppendixSpell | OldWestSpell, source: string): any {
  const costList = spellCostList(s);
  const costs = costList.some(
    (c) => c.type !== "setVariable" && c.type !== "castingTime",
  )
    ? { hitPoints: "", magicPoints: "", others: "", sanity: "", power: "" }
    : {
        hitPoints: s.costs.hitPoints,
        magicPoints: s.costs.magicPoints,
        others: s.costs.others,
        sanity: s.costs.sanity,
        power: s.costs.power,
      };
  return {
    name: s.name,
    type: "spell",
    system: {
      description: {
        value: paragraphs([s.description]),
        keeper: "",
        alternativeNames: "",
      },
      castingTime: s.castingTime,
      costs,
      costList,
      source,
      type: spellTypes(s.name),
    },
  };
}

function bookDoc(t: AppendixTome, source: string): any {
  const biblio = [t.language, t.author && `by ${t.author}`, t.date]
    .filter(Boolean)
    .join(", ");
  const valueParts = [
    [biblio, t.physical].filter(Boolean).join(". ").replace(/\.\./g, "."),
    t.description,
  ];
  const keeperParts = [
    t.link && `Link: ${t.link}`,
    t.relevance && `Relevance: ${t.relevance}`,
    t.spells && `Spells: ${t.spells}`,
    ...(t.errata ?? []),
  ].filter(Boolean) as string[];
  const mythos =
    t.mythosRating > 0 ||
    t.cthulhuMythos.initial > 0 ||
    t.cthulhuMythos.final > 0;
  return {
    name: t.name,
    type: "book",
    system: {
      author: t.author,
      content: "",
      date: t.date,
      description: {
        value: paragraphs(valueParts),
        keeper: paragraphs(keeperParts),
      },
      difficultyLevel: "regular",
      gains: {
        cthulhuMythos: {
          initial: t.cthulhuMythos.initial,
          final: t.cthulhuMythos.final,
        },
        occult: 0,
        others: [],
      },
      language: t.language,
      mythosRating: t.mythosRating,
      sanityLoss: t.sanityLoss.toLowerCase(),
      study: {
        necessary: t.study.necessary,
        units: t.study.units,
      },
      type: { mythos, occult: false, other: !mythos },
      itemDocuments: [],
      itemKeys: [],
    },
  };
}

// The compendium weapon an artefact weapon is compared with, by its skill: it
// supplies what the text leaves out (range, uses per round, damage-bonus
// handling). A thrown blade ("throwing daggers") is compared with a knife,
// which also supplies its damage; otherwise the text's damage stands alone.
const EQUIVALENT_WEAPONS: {
  skill: RegExp;
  text?: RegExp;
  names: string[];
  damage?: boolean;
}[] = [
  {
    skill: /^Firearms \(Handgun\)$/,
    names: [".38 Automatic", ".38 or 9mm Revolver"],
  },
  {
    skill: /^Firearms \(Rifle\/Shotgun\)$/,
    names: [".30-06 Bolt-Action Rifle", ".303 Lee-Enfield"],
  },
  {
    skill: /^Throw$/,
    text: /\b(?:daggers?|knife|knives)\b/i,
    names: ["Knife, Small (switchblade, etc.)", "Knife, Small"],
    damage: true,
  },
  { skill: /^Throw$/, names: ["Shuriken"] },
  { skill: /^Fighting \(Whip\)$/, names: ["Bullwhip"] },
  {
    skill: /^Fighting \(Brawl\)$/,
    names: ["Knife, Small (switchblade, etc.)", "Knife, Small"],
  },
];

function equivalentWeapon(
  a: AppendixArtefact,
  index: Map<string, any> | undefined,
): { weapon: any; damage: boolean } | null {
  const stats = a.weapon;
  if (!stats || !index) return null;
  for (const rule of EQUIVALENT_WEAPONS) {
    if (!rule.skill.test(stats.skill)) continue;
    if (rule.text && !rule.text.test(a.keeper)) continue;
    for (const name of rule.names) {
      const weapon = index.get(name.toLowerCase());
      if (weapon) return { weapon, damage: !!rule.damage };
    }
  }
  return null;
}

function artefactDoc(
  a: AppendixArtefact,
  _source: string,
  weaponIndex?: Map<string, any>,
): any {
  if (a.isWeapon) {
    const stats = a.weapon;
    const match = equivalentWeapon(a, weaponIndex);
    const eq = match?.weapon?.system;
    const thrown = stats?.skill === "Throw";
    const range = (key: "normal" | "long" | "extreme") =>
      String(eq?.range?.[key]?.value ?? "0");
    const normalRange =
      stats?.range || (thrown ? "@STR/5" : eq ? range("normal") : "0");
    const damage =
      stats?.damage || (match?.damage ? (eq?.range?.normal?.damage ?? "") : "");
    const bonus = stats?.damageBonus || (thrown ? "half" : "");
    // A weapon with no damage (a draining prod) takes no damage bonus.
    const fromEquivalent = (flag: "addb" | "ahdb") =>
      !!damage && !!eq?.properties?.[flag];
    return {
      name: a.name,
      type: "weapon",
      system: {
        description: {
          value: paragraphs([a.description]),
          special: "",
          keeper: paragraphs([a.keeper]),
        },
        skill: {
          main: { name: stats?.skill ? skillCocid(stats.skill) : "", id: "" },
          alternativ: { name: "", id: "" },
        },
        range: {
          normal: { value: normalRange, damage },
          long: { value: stats?.range ? "0" : range("long"), damage: "" },
          extreme: { value: stats?.range ? "0" : range("extreme"), damage: "" },
        },
        usesPerRound: stats?.usesMax
          ? { normal: "1", max: stats.usesMax, burst: null }
          : {
              normal: String(eq?.usesPerRound?.normal ?? "1"),
              max: String(eq?.usesPerRound?.max ?? ""),
              burst: null,
            },
        bullets: stats?.shots ?? null,
        ammo: 0,
        malfunction: null,
        blastRadius: null,
        properties: {
          rngd: stats?.ranged ?? !!eq?.properties?.rngd,
          mnvr: false,
          thrown: false,
          shotgun: false,
          dbrl: false,
          impl: !!stats?.impale,
          brst: false,
          auto: false,
          ahdb: bonus ? bonus === "half" : fromEquivalent("ahdb"),
          addb: bonus ? bonus === "full" : fromEquivalent("addb"),
          slnt: false,
          spcl: true,
          mont: false,
          blst: false,
          stun: false,
          rare: false,
          burn: !!stats?.burn,
        },
        price: {},
      },
    };
  }
  return {
    name: a.name,
    type: "item",
    system: {
      description: {
        value: paragraphs([a.description]),
        keeper: paragraphs([a.keeper]),
      },
      quantity: 1,
      weight: 0,
      price: {},
    },
  };
}

// --- Down Darker Trails: occupations, altered/new skills, weapons ----------

const OCCUPATION_CHARS = [
  "str",
  "con",
  "siz",
  "dex",
  "app",
  "int",
  "pow",
  "edu",
];

// A CoC7 "occupation" item document. Every characteristic slot must be present
// (the sheet toggles them individually), so the parsed sparse map is expanded
// over the full set, unselected/unmarked by default.
function occupationDoc(o: OldWestOccupation, source: string): any {
  const occupationSkillPoints = Object.fromEntries(
    OCCUPATION_CHARS.map((c) => [
      c,
      o.occupationSkillPoints[c]
        ? {
            multiplier: o.occupationSkillPoints[c].multiplier,
            selected: true,
            optional: o.occupationSkillPoints[c].optional,
          }
        : { multiplier: null, selected: false, optional: false },
    ]),
  );
  const description = o.special
    ? paragraphs([o.description, `Special: ${o.special}`])
    : paragraphs([o.description]);
  return {
    name: o.name,
    type: "occupation",
    system: {
      description: { value: description, keeper: "" },
      source,
      type: { classic: false, lovecraftian: false, modern: false, pulp: true },
      occupationSkillPoints,
      creditRating: { min: o.creditRating.min, max: o.creditRating.max },
      itemDocuments: [],
      itemKeys: o.skills.map(skillCocid),
      groups: o.groups.map((g) => ({
        options: g.options,
        itemDocuments: [],
        itemKeys: g.skills.map(skillCocid),
      })),
      personal: o.personal,
      personalText: o.personalText,
    },
  };
}

// A CoC7 "skill" item document for one of the book's altered/new skill
// write-ups (its plain, unchanged base-percentage list is not imported — that
// just restates skills already in the system's own compendium).
function oldWestSkillDoc(s: OldWestSkill): any {
  return {
    name: s.name,
    type: "skill",
    system: {
      skillName: s.name,
      specialization: "",
      description: { value: paragraphs([s.description]), keeper: "" },
      base: normalizeSkillBase(s.base),
      adjustments: { base: 0 },
      properties: {},
    },
  };
}

// "10%" -> "10"; "EDU%"/"EDU" -> "@EDU"; "half DEX" -> "@DEX/2"; anything else
// (a formula the sheet wouldn't recognise) falls back to "0".
function normalizeSkillBase(base: string): string {
  const pct = base.match(/^(\d+)%?$/);
  if (pct) return String(Number(pct[1]));
  if (/^EDU%?$/i.test(base)) return "@EDU";
  const half = base.match(/^half\s+([A-Z]{3})$/i);
  if (half) return `@${half[1].toUpperCase()}/2`;
  return "0";
}

// The book prints damage with a literal "+DB"/"+half DB" suffix rather than a
// number (it's the same for every wielder); split it into the CoC7 add-DB
// flags, matching how the system's own weapons store damage.
function splitWeaponDamage(raw: string): {
  damage: string;
  addb: boolean;
  ahdb: boolean;
} {
  if (/\+half\s+DB$/i.test(raw)) {
    return {
      damage: raw.replace(/\+half\s+DB$/i, ""),
      addb: false,
      ahdb: true,
    };
  }
  if (/\+DB$/i.test(raw)) {
    return { damage: raw.replace(/\+DB$/i, ""), addb: true, ahdb: false };
  }
  return { damage: raw, addb: false, ahdb: false };
}

// "1 (3)" -> normal "1", max "3" (fires once without penalty, up to 3 with
// one); "Full Auto" / "1/4" pass through as-is (the system's own uses-per-round
// field is free text for those cases too).
function splitUsesPerRound(raw: string): {
  normal: string;
  max: string | null;
} {
  const m = raw.match(/^(\S+)\s*\((\d+)\)$/);
  return m ? { normal: m[1], max: m[2] } : { normal: raw, max: null };
}

// "Touch" -> 0 yards; a leading number ("30 yards", "80 (50)") is kept, its
// parenthetical alt-mode note dropped; anything else defaults to melee range.
function normalizeRangeValue(raw: string): string {
  if (/^touch\b/i.test(raw)) return "0";
  const m = raw.match(/^(\d+)/);
  return m ? m[1] : "0";
}

// A book-printed weapon (Revolvers/Rifles/.../Melee Weapons table) as a
// standalone reference "weapon" item — its skill is named but not linked to an
// actor's skill (the system falls back to displaying the name; see CoC7
// weapon-system.js #getChatDataSkill), same as a compendium weapon would be
// before an actor's own skill is resolved for it.
function weaponDoc(w: OldWestWeapon, source: string): any {
  const { damage, addb, ahdb } = splitWeaponDamage(
    w.damage.replace(/\s*\([^)]*\)\s*$/, ""),
  );
  const damageParts = damage.split("/");
  const { normal: usesNormal, max: usesMax } = splitUsesPerRound(
    w.usesPerRound,
  );
  return {
    name: w.name,
    type: "weapon",
    system: {
      description: { value: "", special: "", keeper: "" },
      skill: {
        main: { name: w.skill, id: "" },
        alternativ: { name: "", id: "" },
      },
      range: {
        normal: {
          value: normalizeRangeValue(w.baseRange),
          damage: damageParts[0] ?? "",
        },
        long: { value: "0", damage: damageParts[1] ?? "" },
        extreme: { value: "0", damage: damageParts[2] ?? "" },
      },
      usesPerRound: { normal: usesNormal, max: usesMax, burst: null },
      bullets: w.bullets,
      ammo: w.bullets ?? 0,
      malfunction: w.malfunction,
      blastRadius: null,
      properties: {
        rngd: w.ranged,
        mnvr: false,
        thrown: w.thrown,
        shotgun: false,
        dbrl: false,
        impl: w.impale,
        brst: false,
        auto: w.auto,
        ahdb,
        addb,
        slnt: false,
        spcl: false,
        mont: false,
        blst: false,
        stun: false,
        rare: /^(?:R|VR)$/.test(w.availability),
        burn: /burn/i.test(w.damage),
      },
      price: { downDarkerTrails: w.cost },
    },
  };
}

// Build the Foundry item document for a parsed world item.
export function pulpItemDoc(
  item: PulpItem | OldWestItem,
  source: string,
  weaponIndex?: Map<string, any>,
): any {
  switch (item.kind) {
    case "talent":
      return talentDoc(item, source);
    case "archetype":
      return archetypeDoc(item, source);
    case "spell":
      return spellDoc(item, source);
    case "tome":
      return bookDoc(item, source);
    case "artefact":
      return artefactDoc(item, source, weaponIndex);
    case "occupation":
      return occupationDoc(item, source);
    case "oldWestSkill":
      return oldWestSkillDoc(item);
    case "oldWestWeapon":
      return weaponDoc(item, source);
  }
}

// --- world creation --------------------------------------------------------

// The subfolder each item kind is filed under, within the document's Item folder.
const ITEM_TYPE_FOLDERS: Record<string, string> = {
  talent: "Talents",
  archetype: "Archetypes",
  spell: "Spells",
  tome: "Tomes",
  artefact: "Artefacts",
  occupation: "Occupations",
  oldWestSkill: "Skills",
  oldWestWeapon: "Weapons",
};

// The icon each item kind gets at creation time (not part of the parsed source
// data). A kind with no entry keeps Foundry's default icon for that item type.
const ITEM_TYPE_ICONS: Record<string, string> = {
  talent: "systems/CoC7/assets/icons/skills.svg",
  archetype: "systems/CoC7/assets/icons/skills.svg",
  spell: "systems/CoC7/assets/icons/pentagram-rose.svg",
  tome: "systems/CoC7/assets/icons/secret-book.svg",
  occupation: "systems/CoC7/assets/icons/skills.svg",
};

export interface CreatePulpItemsOptions {
  /** Name of the parent Item folder: the book's title. */
  folderName?: string;
  /** The source PDF's file name (without extension): recorded on the folder
   * so a re-import finds it, and the name older imports gave the folder. */
  sourceFile?: string;
  /** The book's title: each item cites it with its page in its Keeper notes
   * and, where the type has one, its `system.source`. */
  source?: string;
  /** Show a UI notification summarising the result (default true). */
  notify?: boolean;
}

export interface CreatePulpItemsResult {
  created: number;
  failed: number;
  items: any[];
}

// Build and create world item documents under a "<folderName>" Item folder, one
// subfolder per item kind ("Talents", "Spells", ...). Artefacts and tomes nest
// further under a region folder when the appendix printed one (Artefacts/Peru/...).
// Idempotent per leaf folder: a re-import replaces same-named items under
// their existing ids.
export async function createPulpItems(
  items: ((PulpItem | OldWestItem) & SourcePage)[],
  options: CreatePulpItemsOptions = {},
): Promise<CreatePulpItemsResult> {
  const result: CreatePulpItemsResult = { created: 0, failed: 0, items: [] };
  if (items.length === 0) return result;

  const source = options.source ?? options.folderName ?? "PDF Import";
  // Artefact weapons are compared with the system's weapons.
  const weaponIndex = items.some((i) => i.kind === "artefact" && i.isWeapon)
    ? await loadWeaponIndex()
    : undefined;
  // Tomes list spells that the system's spells may hold.
  const systemSpells = items.some(
    (i) => i.kind === "tome" && tomeSpellNames(i.spells).length,
  )
    ? systemSpellMatcher(await loadSpellIndex())
    : undefined;
  // The book's own spells, once created, for its tomes to hold.
  const bookSpells: SpellCandidate<any>[] = [];
  const parentName = options.folderName ?? "PDF Import";
  const parent = await ensureBookFolder(
    "Item",
    parentName,
    options.sourceFile ?? parentName,
  );

  // Group by kind, then (for artefacts and tomes) by region, so each leaf folder is filled
  // in one pass and re-import replace stays scoped to that folder.
  type Entry = (PulpItem | OldWestItem) & SourcePage;
  type Leaf = { folderPath: string[]; group: Entry[] };
  const leaves: Leaf[] = [];
  const byKind = new Map<string, Entry[]>();
  for (const item of items) {
    const list = byKind.get(item.kind) ?? [];
    list.push(item);
    byKind.set(item.kind, list);
  }

  for (const [kind, group] of byKind) {
    const typeFolder = ITEM_TYPE_FOLDERS[kind] ?? kind;
    if (kind === "artefact" || kind === "tome") {
      const byRegion = new Map<string, Entry[]>();
      for (const item of group) {
        const region = "region" in item && item.region ? item.region : "";
        const list = byRegion.get(region) ?? [];
        list.push(item);
        byRegion.set(region, list);
      }
      for (const [region, regionGroup] of byRegion) {
        leaves.push({
          folderPath: region ? [typeFolder, region] : [typeFolder],
          group: regionGroup,
        });
      }
    } else {
      leaves.push({ folderPath: [typeFolder], group });
    }
  }
  // Spells are created before the tomes that hold them.
  leaves.sort(
    (a, b) =>
      Number(a.group[0]?.kind === "tome") - Number(b.group[0]?.kind === "tome"),
  );

  for (const leaf of leaves) {
    let folder = parent;
    for (const name of leaf.folderPath) {
      folder = await ensureItemFolder(name, folder?.id ?? null);
    }
    const kind = leaf.group[0]?.kind ?? "";
    const img = ITEM_TYPE_ICONS[kind];
    const docs = leaf.group.map((item) => {
      const doc = citedItemDoc(item, source, weaponIndex);
      if (item.kind === "tome")
        linkTomeSpells(doc, item.spells, bookSpells, systemSpells);
      return doc;
    });
    const replaced = await claimReplacedItems(folder, docs);
    for (const doc of docs) {
      try {
        const created = await createReplacing(
          Item,
          replaced.take(doc.name),
          { ...doc, ...(img ? { img } : {}), folder: folder?.id ?? null },
          KEPT_ITEM_FIELDS,
        );
        result.items.push(created);
        result.created++;
        if (kind === "spell") bookSpells.push(embeddedSpell(created));
      } catch (err) {
        result.failed++;
        console.error(
          `coc-pdf-importer: failed to create ${kind} "${doc.name}"`,
          err,
        );
      }
    }
  }
  if (options.notify !== false) {
    ui.notifications.info(
      result.failed
        ? `Imported ${result.created} items, ${result.failed} failed (see console).`
        : `Imported ${result.created} items.`,
    );
  }
  return result;
}

// An item's document citing its source: in `system.source` where the type
// has one, and as the first paragraph of its Keeper notes.
function citedItemDoc(
  item: (PulpItem | OldWestItem) & SourcePage,
  source: string,
  weaponIndex?: Map<string, any>,
): any {
  const citation = sourceCitation(source, item);
  const doc = pulpItemDoc(item, citation, weaponIndex);
  const description = (doc.system.description ??= {});
  description.keeper = citationHtml(citation) + (description.keeper ?? "");
  return doc;
}

// The system's spells by name and alternative names, each standing for its
// CoC ID.
function systemSpellMatcher(index: Map<string, any>): SpellMatcher<string> {
  return new SpellMatcher(
    indexedSpells(index).map((c) => ({
      ...c,
      value: c.value.flags.CoC7.cocidFlag.id,
    })),
  );
}

// A created spell as a tome holds it: a copy of the item, as the system
// stores a spell dropped on a book's Spells tab.
function embeddedSpell(created: any): SpellCandidate<any> {
  const data = created.toObject ? created.toObject() : { ...created };
  data._id = created.id;
  delete data.folder;
  return { name: data.name, value: data };
}

// Fill a tome's Spells tab from its printed spell list: a spell of the book's
// own is held as a copy, else a system spell by its CoC ID. A name that
// matches neither stays only in the Keeper notes' "Spells:" line.
function linkTomeSpells(
  doc: any,
  list: string,
  bookSpells: SpellCandidate<any>[],
  systemSpells: SpellMatcher<string> | undefined,
): void {
  const book = new SpellMatcher(bookSpells);
  const documents: any[] = [];
  const keys: string[] = [];
  for (const name of tomeSpellNames(list)) {
    const own = book.match(name);
    if (own) {
      if (!documents.includes(own)) documents.push(own);
      continue;
    }
    const cocid = systemSpells?.match(name);
    if (cocid && !keys.includes(cocid)) keys.push(cocid);
  }
  doc.system.itemDocuments = documents;
  doc.system.itemKeys = keys;
}

// Find (by name and parent) or create an Item folder.
async function ensureItemFolder(
  name: string,
  parentId: string | null,
): Promise<FoundryFolder | null> {
  const existing = game.folders?.find(
    (f: any) =>
      f.name === name &&
      f.type === "Item" &&
      (f.folder?.id ?? f.folder ?? null) === parentId,
  );
  if (existing) return existing;
  try {
    return await Folder.create({ name, type: "Item", folder: parentId });
  } catch {
    return null;
  }
}

// Fields of a replaced item that the Keeper owns rather than the book: they
// carry over to its replacement along with the id. The icon is not among them;
// it is assigned per kind at creation.
const KEPT_ITEM_FIELDS = ["ownership", "sort"];

// The items already in `folder` that incoming documents will replace.
async function claimReplacedItems(
  folder: FoundryFolder | null,
  docs: any[],
): Promise<{ take(name: string): FoundryItem | null }> {
  const existing = folder?.id
    ? (game.items?.filter(
        (i) => ((i.folder as any)?.id ?? i.folder ?? null) === folder.id,
      ) ?? [])
    : [];
  return claimReplaced(
    existing,
    docs.map((d) => d.name),
  );
}

// --- orchestration ---------------------------------------------------------

export interface ImportDocumentOptions {
  /** The source PDF's file name without extension: the key that finds the
   * book's folders again on a re-import. */
  folderName?: string;
  /** The book's title: the Actor and Item folders' name and the title in
   * source citations (default: derived from the file name). */
  bookTitle?: string;
  /** Show a UI notification summarising the result (default true). */
  notify?: boolean;
}

export interface ImportDocumentResult {
  actors: ImportResult;
  items: CreatePulpItemsResult;
}

// Import a document's actors and items in one call. Actors are created at the top
// level of a "<folderName>" Actor folder (unchanged, for compatibility); items go
// into typed subfolders of a same-named Item folder (see createPulpItems).
export async function importDocument(
  data: Uint8Array,
  options: ImportDocumentOptions = {},
): Promise<ImportDocumentResult> {
  const sourceFile = options.folderName ?? "PDF Import";
  const { actors, items } = await processPDF(data, { fileName: sourceFile });
  const title = options.bookTitle || bookTitleFromFileName(sourceFile);
  const actorResult = await importCharacters(actors, {
    folderName: title,
    sourceFile,
    notify: false,
    source: title,
    bookSpells: items
      .filter((i) => i.kind === "spell")
      .map((i) => citedItemDoc(i, title)),
  });
  const itemResult = await createPulpItems(items, {
    folderName: title,
    sourceFile,
    notify: false,
    source: title,
  });
  if (options.notify !== false) {
    const failed = actorResult.failed + itemResult.failed;
    ui.notifications.info(
      `Imported ${actorResult.created} actors and ${itemResult.created} items` +
        (failed ? `, ${failed} failed (see console).` : "."),
    );
  }
  return { actors: actorResult, items: itemResult };
}
