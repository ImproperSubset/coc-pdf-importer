import type {
  BackgroundSection,
  CocCharacter,
  CombatEntry,
  PulpTalentRef,
} from "./process.ts";
import { claimReplaced, createReplacing } from "./replace.ts";

// Foundry globals (game, ui, Actor, Folder) are declared in ./foundry.d.ts.

// "character" is a full Investigator; "npc" a plain NPC; "creature" a Mythos
// monster. Pre-gen investigators (with a background block) import as "character".
type EntityType = "npc" | "creature" | "character";

export interface ImportOptions {
  /** Force the actor type, or 'auto' to guess from the stat block. */
  entity?: EntityType | "auto";
  /** Name of the Actor folder to place imported characters in. */
  folderName?: string;
  /** Show a UI notification summarising the result (default true). */
  notify?: boolean;
}

export interface ImportResult {
  created: number;
  failed: number;
  actors: any[];
  /** How many of `created` are Pulp variants (in the "<folder> (Pulp)" folder). */
  pulp: number;
}

/**
 * Create Foundry CoC7 actors from parsed characters.
 */
export async function importCharacters(
  characters: CocCharacter[],
  options: ImportOptions = {},
): Promise<ImportResult> {
  const folder = await ensureActorFolder(options.folderName ?? "PDF Import");
  // The folder is named after the imported file, so a re-import refreshes its
  // contents: an actor already in it that shares a name with an incoming one is
  // replaced under the same id rather than duplicated.
  const replaced = await claimReplacedActors(folder, characters);
  const result: ImportResult = { created: 0, failed: 0, actors: [], pulp: 0 };

  // Look up the system's skill/weapon/spell/talent compendia once for the whole
  // batch, so imported items adopt the real compendium item (CoCID, icon,
  // properties, damage) where one exists.
  const indexes = await loadIndexes();

  for (const character of characters) {
    try {
      const actor = await importCharacter(
        character,
        folder,
        options.entity ?? "auto",
        indexes,
        [],
        replaced.take(character),
      );
      result.actors.push(actor);
      result.created++;
    } catch (err) {
      result.failed++;
      console.error(
        `coc-pdf-importer: failed to import "${character.name}"`,
        err,
      );
    }
  }

  // Stat blocks that carry "Pulp Combat" / "Pulp Talents" sections are imported
  // a second time as their Pulp Cthulhu variant, into a sibling "<folder>
  // (Pulp)" folder created only when there is at least one of them.
  const pulpCharacters = characters.filter((c) => c.pulp);
  if (pulpCharacters.length) {
    const pulpFolder = await ensureActorFolder(
      `${options.folderName ?? "PDF Import"} (Pulp)`,
    );
    const pulpReplaced = await claimReplacedActors(pulpFolder, pulpCharacters);
    for (const character of pulpCharacters) {
      try {
        const actor = await importCharacter(
          pulpVariant(character),
          pulpFolder,
          options.entity ?? "auto",
          indexes,
          talentItems(character.pulp!.talents, indexes.talent),
          pulpReplaced.take(character),
        );
        result.actors.push(actor);
        result.created++;
        result.pulp++;
      } catch (err) {
        result.failed++;
        console.error(
          `coc-pdf-importer: failed to import pulp variant of "${character.name}"`,
          err,
        );
      }
    }
  }
  let msg: string;
  if (!result.failed) {
    msg = game.i18n.format("coc-pdf-importer.ResultSuccess", {
      created: result.created,
    });
  } else {
    msg = game.i18n.format("coc-pdf-importer.ResultWithErrors", {
      created: result.created,
      failed: result.failed,
    });
  }
  if (options.notify !== false) ui.notifications.info(msg);
  return result;
}

async function importCharacter(
  character: CocCharacter,
  folder: any,
  entity: EntityType | "auto",
  indexes: CompendiumIndexes,
  extraItems: any[] = [],
  replacing: FoundryActor | null = null,
): Promise<any> {
  const type = entity === "auto" ? guessEntityType(character) : entity;

  const actor = await createReplacing(
    Actor,
    replacing,
    {
      name: character.name || "Unknown",
      type,
      folder: folder?.id ?? null,
      system: buildActorSystem(character, type),
    },
    KEPT_ACTOR_FIELDS,
  );

  const { base, customWeapons } = buildItems(character, indexes);
  const embedded = [...base, ...extraItems];
  if (embedded.length) {
    await actor.createEmbeddedDocuments("Item", embedded, {
      renderSheet: false,
    });
  }
  // Weapons not found in a compendium need a backing skill created and linked by
  // id (the system can't resolve them, which pops a "select weapon skill" modal).
  // Done after the base items so their skills — including ones the compendium
  // weapons created — can be reused.
  await attachCustomWeapons(actor, customWeapons, indexes, type);

  await applyDerivedOverrides(actor, character);
  return actor;
}

// ---------------------------------------------------------------------------
// Pulp variant
// ---------------------------------------------------------------------------

// The character as its Pulp Cthulhu variant: the "Pulp Combat" profiles replace
// the standard ones of the same name (others are kept, new ones added), and the
// pulp HP / Luck values, where printed, replace the standard ones.
function pulpVariant(character: CocCharacter): CocCharacter {
  const pulp = character.pulp!;
  const same = (a: CombatEntry, b: CombatEntry) =>
    a.name.toLowerCase() === b.name.toLowerCase();
  const combat = character.combat.map(
    (entry) => pulp.combat.find((p) => same(p, entry)) ?? entry,
  );
  for (const p of pulp.combat)
    if (!combat.some((entry) => same(entry, p))) combat.push(p);
  const characteristics = { ...character.characteristics };
  if (pulp.hp != null)
    characteristics.HP = {
      value: pulp.hp,
      raw: String(pulp.hp),
      marked: false,
    };
  const derived = { ...character.derived };
  if (pulp.luck != null) derived.Luck = pulp.luck;
  return {
    ...character,
    combat,
    attacksPerRound: pulp.attacksPerRound ?? character.attacksPerRound,
    characteristics,
    derived,
  };
}

// The talent category flags of a CoC7 talent item; an inline talent built from
// a stat block has no known category.
const TALENT_TYPE_FLAGS = [
  "physical",
  "mental",
  "combat",
  "miscellaneous",
  "basic",
  "insane",
  "other",
] as const;

// Embedded talent items for a "Pulp Talents" list. A talent already in the
// world (or the talent compendium) whose name matches — case-insensitively —
// is used (a full name match means it is the talent the block lists), keeping
// its icon, category and CoCID but taking the book's own description, so the
// sheet reads as the stat block does. Any other becomes an inline talent.
function talentItems(refs: PulpTalentRef[], talentIndex: ItemIndex): any[] {
  return refs.map((ref) => {
    const description = escapeHtml(ref.description);
    const found = talentIndex.get(ref.name.toLowerCase());
    if (found) {
      const data = structuredClone(found);
      delete data._id;
      data.system = data.system ?? {};
      data.system.description = {
        ...(data.system.description ?? {}),
        value: description,
      };
      return data;
    }
    return {
      name: ref.name,
      type: "talent",
      system: {
        source: "",
        description: { value: description, notes: "", keeper: "" },
        type: Object.fromEntries(
          TALENT_TYPE_FLAGS.map((flag) => [flag, flag === "other"]),
        ),
        adjustments: [],
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Entity type / actor system data
// ---------------------------------------------------------------------------

// The background sections that bind a playable investigator to the world. A
// pre-gen player character fills these in; scenario NPCs and Pulp villains built
// on the same human stat block get at most a description + traits blurb.
const TIE_SECTIONS = new Set([
  "Significant People",
  "Meaningful Locations",
  "Treasured Possession",
]);

// A real pre-gen investigator fills in at least one "ties to the world" section
// AND is a fully realized playable character — it records an age and/or carries
// a carried-gear list (from a bare "Possessions"/"Equipment" section; every
// pregen in the sample has one, no NPC/villain does). The ties requirement
// rejects scenario NPCs and villains built on a human stat block (a description +
// traits blurb, or a stray equipment line, is not enough).
function isInvestigator(character: CocCharacter): boolean {
  const hasTies = character.background.some((s) => TIE_SECTIONS.has(s.title));
  return hasTies && (character.age != null || character.items.length > 0);
}

// An investigator becomes a "character"; a Sanity loss line marks a Mythos
// creature; everyone else is an NPC.
function guessEntityType(character: CocCharacter): EntityType {
  if (isInvestigator(character)) return "character";
  return character.sanityLoss ? "creature" : "npc";
}

function buildActorSystem(
  character: CocCharacter,
  type: EntityType,
): Record<string, unknown> {
  const system: any = {
    characteristics: {},
    attribs: {},
    infos: {},
    description: { keeper: notesToHtml(character, type) },
  };
  // "special" (sanLoss / attacksPerRound) exists on npc/creature only, not on the
  // Investigator "character" type.
  if (type !== "character") system.special = {};
  // An unlocked NPC/creature sheet shows every inventory section, empty or not;
  // the system defaults these types unlocked (Investigators are locked).
  if (type !== "character") system.flags = { locked: true };

  // STR/CON/SIZ/DEX/INT/APP/POW/EDU are characteristics; SAN/HP are attribs.
  const charMap: Record<string, string> = {
    STR: "str",
    CON: "con",
    SIZ: "siz",
    DEX: "dex",
    INT: "int",
    APP: "app",
    POW: "pow",
    EDU: "edu",
  };
  for (const [src, dst] of Object.entries(charMap)) {
    const value =
      character.characteristics[src as keyof typeof character.characteristics]
        ?.value;
    if (value != null) system.characteristics[dst] = { value };
  }

  const san = character.characteristics.SAN?.value;
  const hp = character.characteristics.HP?.value;
  if (san != null) system.attribs.san = { value: san };
  if (hp != null) system.attribs.hp = { value: hp };
  if (character.derived.MP != null)
    system.attribs.mp = { value: character.derived.MP };
  if (character.derived.Move != null)
    system.attribs.mov = { value: character.derived.Move };
  if (character.derived.Build != null)
    system.attribs.build = { value: character.derived.Build };
  if (character.derived.Luck != null)
    system.attribs.lck = { value: character.derived.Luck };
  if (character.derived.DB != null)
    system.attribs.db = { value: normalizeDb(character.derived.DB) };

  if (character.age != null) system.infos.age = String(character.age);
  // A creature sheet shows its descriptor as "Type"; an NPC's or
  // investigator's as "Occupation".
  if (character.description) {
    if (type === "creature") system.infos.type = character.description;
    else system.infos.occupation = character.description;
  }

  if (system.special) {
    const sanLoss = parseSanLoss(character.sanityLoss);
    if (sanLoss) system.special.sanLoss = sanLoss;
    const apr = parseAttacksPerRound(character.attacksPerRound);
    if (apr != null) system.special.attacksPerRound = apr;
  }

  const armor = armorAttrib(character.armor);
  if (armor) system.attribs.armor = armor;

  // Investigator background -> the character sheet's backstory (a single HTML
  // block) and biography (per-section {title, value} rows the sheet renders).
  if (type === "character" && character.background.length) {
    system.backstory = backstoryHtml(character.background);
    system.biography = character.background.map((s) => ({
      title: s.title,
      value: `<p>${escapeHtml(s.text)}</p>`,
    }));
  }

  return system;
}

// Combine the background sections into the single HTML block stored in
// system.backstory, matching the layout the CoC7 Dhole House importer produces.
function backstoryHtml(sections: BackgroundSection[]): string {
  const block = sections
    .map(
      (s) =>
        `<h3>${escapeHtml(s.title)}</h3>\n<div>\n${escapeHtml(s.text)}\n</div>`,
    )
    .join("\n");
  return `<h2>Backstory</h2>\n${block}`;
}

// Map a parsed armor descriptor to the CoC7 armor attrib: the leading "N-point"
// number becomes the armor value (0 for "none"/prose), and the full text is kept
// as the armor notes. `auto: false` stops the sheet re-deriving it from items.
function armorAttrib(
  armor: string | null,
): { value: number; auto: boolean; notes: string } | null {
  if (!armor) return null;
  const points = /(\d+)\s*-?\s*point/i.exec(armor);
  return { value: points ? Number(points[1]) : 0, auto: false, notes: armor };
}

// After creation the system auto-derives HP/MP/MOV/build/DB from characteristics;
// where the imported value differs, turn off auto and set it explicitly.
async function applyDerivedOverrides(
  actor: any,
  character: CocCharacter,
): Promise<void> {
  const update: Record<string, unknown> = {};

  const override = (
    key: string,
    imported: number | null | undefined,
    computed: number,
    max = true,
  ) => {
    if (imported == null) return;
    const value = Math.max(0, Number(imported));
    if (Number.isNaN(value) || value === Number(computed)) return;
    update[`system.attribs.${key}.auto`] = false;
    update[`system.attribs.${key}.value`] = value;
    if (max) update[`system.attribs.${key}.max`] = value;
  };

  const attribs = actor.system?.attribs ?? {};
  override("hp", character.characteristics.HP?.value, attribs.hp?.max);
  override("mp", character.derived.MP, attribs.mp?.max);
  override("mov", character.derived.Move, attribs.mov?.value, false);
  override("build", character.derived.Build, attribs.build?.value, false);

  if (character.derived.DB != null) {
    const value = normalizeDb(character.derived.DB);
    if (value !== String(attribs.db?.value)) {
      update["system.attribs.db.auto"] = false;
      update["system.attribs.db.value"] = value;
    }
  }

  if (Object.keys(update).length) await actor.update(update);
}

// ---------------------------------------------------------------------------
// Items (skills, weapons + backing skills, languages, spells)
// ---------------------------------------------------------------------------

// A lowercase name -or- CoCID -> compendium item (plain data) lookup.
type ItemIndex = Map<string, any>;
interface CompendiumIndexes {
  skill: ItemIndex;
  weapon: ItemIndex;
  spell: ItemIndex;
  talent: ItemIndex;
}

// Fetch the system's skill/weapon/spell/talent compendia once (world + packs,
// best per era/language) and index each by lowercase name and CoCID. Degrades
// gracefully to empty indexes when the CoC7 API is absent (unit tests, non-CoC7
// world), in which case items are built from the parsed data alone.
async function loadIndexes(): Promise<CompendiumIndexes> {
  const [skill, weapon, spell, talent] = await Promise.all([
    loadSkillIndex(),
    loadCocidIndex(/^i\.weapon\./),
    loadCocidIndex(/^i\.spell\./),
    loadTalentIndex(),
  ]);
  return { skill, weapon, spell, talent };
}

// Talents: the world's own talent items (e.g. those a Pulp Cthulhu import
// created, which carry no CoCID) plus any in the packs.
async function loadTalentIndex(): Promise<ItemIndex> {
  const index = await loadCocidIndex(/^i\.talent\./);
  try {
    const world = game.items?.filter((i) => i.type === "talent") ?? [];
    indexDocuments(index, world);
  } catch (err) {
    console.warn("coc-pdf-importer: world talent lookup unavailable", err);
  }
  return index;
}

// Skills come from the system's dedicated (cached) skill list.
async function loadSkillIndex(): Promise<ItemIndex> {
  const index: ItemIndex = new Map();
  try {
    const list = await game.CoC7?.skillNames?.getList?.();
    if (list) indexDocuments(index, Object.values(list));
  } catch (err) {
    console.warn("coc-pdf-importer: skill compendium lookup unavailable", err);
  }
  return index;
}

// Weapons/spells come from a CoCID-regex query over world + packs. The best
// query keeps only items flagged for the world's era (or for no era), so an
// item flagged only for other eras — Core Content's weapons in a Pulp world —
// would be dropped. Those fill in from an unfiltered query, without displacing
// an era match.
async function loadCocidIndex(cocidRegExp: RegExp): Promise<ItemIndex> {
  const index: ItemIndex = new Map();
  try {
    const docs = await game.CoC7?.cocid?.fromCoCIDRegexBest?.({
      cocidRegExp,
      type: "i",
    });
    if (docs) indexDocuments(index, docs);
  } catch (err) {
    console.warn("coc-pdf-importer: compendium lookup unavailable", err);
  }
  try {
    const docs = await game.CoC7?.cocid?.fromCoCIDRegexAll?.({
      cocidRegExp,
      type: "i",
      era: false,
    });
    if (docs) indexDocuments(index, otherEraItems(index, docs), false);
  } catch (err) {
    console.warn(
      "coc-pdf-importer: other-era compendium lookup unavailable",
      err,
    );
  }
  return index;
}

// One item per CoCID the index lacks, preferring the world's language.
function otherEraItems(index: ItemIndex, docs: any[]): any[] {
  const lang = game.i18n.lang;
  const byCocid = new Map<string, any>();
  for (const doc of docs) {
    const data = doc?.toObject ? doc.toObject() : doc;
    const cocid = String(data?.flags?.CoC7?.cocidFlag?.id ?? "").toLowerCase();
    if (!cocid || index.has(cocid)) continue;
    const held = byCocid.get(cocid);
    if (
      !held ||
      (held.flags.CoC7.cocidFlag.lang !== lang &&
        data.flags.CoC7.cocidFlag.lang === lang)
    )
      byCocid.set(cocid, data);
  }
  return [...byCocid.values()];
}

// Index documents by lowercase name and CoCID. With `replace` false, a key
// already in the index keeps its document.
function indexDocuments(index: ItemIndex, docs: any[], replace = true): void {
  const put = (key: string, data: any) => {
    if (replace || !index.has(key)) index.set(key, data);
  };
  for (const doc of docs) {
    const data = doc?.toObject ? doc.toObject() : doc;
    if (!data) continue;
    if (data.name) put(String(data.name).toLowerCase(), data);
    const cocid = data.flags?.CoC7?.cocidFlag?.id;
    if (cocid) put(String(cocid).toLowerCase(), data);
  }
}

// Find a compendium item by full name or CoCID. A specialized skill with no exact
// entry falls back to its generic "(Any)" template ("Science (Biology)" ->
// "Science (Any)"); weapons reference their backing skill by CoCID.
function findCompendiumItem(ref: string, index: ItemIndex): any | null {
  const direct = index.get(ref.toLowerCase());
  if (direct) return direct;
  const m = ref.match(/^([^(]+)\(.+\)\s*$/);
  if (m) {
    const any = index.get(`${m[1].trim()} (Any)`.toLowerCase());
    if (any) return any;
  }
  return null;
}

// Kebab-case a name for a CoCID (matches CoC7Utilities.toKebabCase).
function toKebabCase(s: string): string {
  const m = (s ?? "").match(
    /[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g,
  );
  return m ? m.join("-").toLowerCase() : "";
}

// Stamp the CoCID flag ("i.skill.spot-hidden") the system uses to recognise an
// item, derived from its final name.
function setCocid(data: any, type: string): void {
  const id = `i.${type}.${toKebabCase(data.name ?? "")}`;
  data.flags = data.flags ?? {};
  data.flags.CoC7 = data.flags.CoC7 ?? {};
  data.flags.CoC7.cocidFlag = { ...(data.flags.CoC7.cocidFlag ?? {}), id };
}

// ---------------------------------------------------------------------------
// Weapon matching: stat blocks abbreviate weapon names ("​.38 revolver",
// "12-g shotgun", "Knife"); map those to the canonical compendium item. Each
// candidate lists the core (preferred) name first and a wiki (fallback) name
// second, so matchWeapon resolves against whichever pack is installed, falling
// back to a custom weapon when neither has it.
// ---------------------------------------------------------------------------

const KNIFE_BY_SIZE: Record<string, string[]> = {
  Small: ["Knife, Small (switchblade, etc.)", "Knife, Small"],
  Medium: ["Knife, Medium (carving knife, etc.)", "Knife, Medium"],
  Large: ["Knife, Large (machete, etc.)", "Knife, Large"],
};
const CLUB_BY_SIZE: Record<string, string[]> = {
  Small: ["Club, small (nightstick)", "Club, Small"],
  Large: ["Club, large (baseball, cricket bat, poker)", "Club, Large"],
};

// Knives and clubs come in sizes the stat block only distinguishes by damage:
// small club 1D6 / large club 1D8; small knife 1D4, medium 1D4+2, large 1D8.
// The weapon's own damage is the *leading* term — a trailing damage bonus
// ("+DB", or a die like "+1D6") is ignored by anchoring the checks at the start.
function meleeCandidates(attack: CombatEntry): string[] {
  const name = attack.name.toLowerCase();
  const dmg = (attack.damage ?? "").toLowerCase().replace(/\s+/g, "");
  // An energy weapon is never a melee weapon ("Laser staff" is not a club).
  if (ENERGY_WEAPON_RE.test(name)) return [];
  if (/cosh|blackjack/.test(name))
    return ["Blackjack (Cosh, life-preserver)", "Blackjack"];
  // Any name containing "sword" (generic, so unique names like "Sword of
  // Akmallah" or compounds like "broadsword" need no hardcoding): a heavy-saber
  // damage picks the heavy sword, otherwise medium — the book-damage override
  // corrects a mismatch either way.
  if (/sword/.test(name)) {
    return /^1d8\+1\b/.test(dmg)
      ? ["Sword, heavy (cavalry saber)"]
      : ["Sword, medium (rapier, heavy epee)"];
  }
  if (
    /\bknife\b|\bdagger\b|switchblade|straight razor|\bmachete\b|\bscalpel\b/.test(
      name,
    )
  ) {
    const size = /^1d8\b/.test(dmg)
      ? "Large"
      : /^1d4\+2\b/.test(dmg)
        ? "Medium"
        : /^1d4\b/.test(dmg)
          ? "Small"
          : "Medium";
    return KNIFE_BY_SIZE[size];
  }
  // Clubs and other blunt weapons (crowbar, bat, wrench, spade, ...): a large
  // club is 1D8, a small club 1D6; default large.
  if (
    /\bclub\b|nightstick|truncheon|cudgel|crowbar|\bwrench\b|\bhammer\b|\bbat\b|\bspade\b|\bmallet\b|walking stick|\bstaff\b|\bbaton\b|pickaxe/.test(
      name,
    )
  ) {
    const size = /^1d8\b/.test(dmg)
      ? "Large"
      : /^1d6\b/.test(dmg)
        ? "Small"
        : /nightstick|walking stick|\bbaton\b/.test(name)
          ? "Small"
          : "Large";
    return CLUB_BY_SIZE[size];
  }
  return [];
}

// Name-pattern aliases for firearms (and the Thompson). "handgun" rules do not
// apply to rifle names (".45 Martini-Henry Rifle" is not a .45 pistol).
const WEAPON_ALIASES: {
  re: RegExp;
  names: string[];
  handgun?: boolean;
}[] = [
  { re: /\bthompson\b/i, names: ["Thompson (50 mag)", "Thompson"] },
  // handgun automatics (before the caliber default)
  {
    re: /\.45\b.*\b(auto|automatic|pistol)\b/i,
    names: [".45 Automatic"],
    handgun: true,
  },
  {
    re: /\.38\b.*\b(auto|automatic|pistol)\b/i,
    names: [".38 Automatic"],
    handgun: true,
  },
  {
    re: /\.32\b.*\b(auto|automatic|pistol)\b/i,
    names: [".32 or 7.65mm Automatic"],
    handgun: true,
  },
  {
    re: /\.22\b.*\b(auto|automatic)\b/i,
    names: [".22 Short Automatic"],
    handgun: true,
  },
  // handgun revolvers / caliber defaults
  { re: /\.45\b.*revolver/i, names: [".45 Revolver"], handgun: true },
  { re: /\.45\b/i, names: [".45 Automatic"], handgun: true },
  { re: /\.38\b/i, names: [".38 or 9mm Revolver"], handgun: true },
  { re: /\.32\b/i, names: [".32 or 7.65mm Revolver"], handgun: true },
  { re: /\.357\b/i, names: [".357 Magnum Revolver"], handgun: true },
  { re: /\.44\b/i, names: [".44 Magnum Revolver"], handgun: true },
  { re: /\.41\b/i, names: [".41 Revolver"], handgun: true },
  { re: /\.25\b.*derringer/i, names: [".25 Derringer (1B)"], handgun: true },
  // rifles
  { re: /\.30-06\b/i, names: [".30-06 Bolt-Action Rifle"] },
  { re: /\.303\b/i, names: [".303 Lee-Enfield"] },
  { re: /\belephant\b[^.]*\bgun\b/i, names: ["Elephant Gun (2B)"] },
  {
    re: /browning\s+auto(?:matic)?\s+rifle/i,
    names: ["Browning Auto Rifle M1918"],
  },
  // named handguns whose flavor name hides a standard caliber
  { re: /\bwebley\b/i, names: [".38 or 9mm Revolver"], handgun: true },
  { re: /\bnambu\b/i, names: [".32 or 7.65mm Automatic"], handgun: true },
  // shotguns: 12-gauge variants (a 12-gauge or a shotgun of no stated gauge,
  // never a rifle), then each gauge's double barrel, then a shotgun of no
  // stated gauge as the standard 12-gauge double barrel
  {
    re: /^(?!.*\b(?:10|16|20)[\s-]?(?:g|ga|gauge|gage)\b)(?!.*\b(?:rifle|carbine)\b).*\b(?:sawed|sawn)[\s-]?off\b/i,
    names: ["12-gauge Shotgun (2B sawed off)"],
  },
  {
    re: /^(?!.*\b(?:10|16|20)[\s-]?(?:g|ga|gauge|gage)\b)(?=.*\b(?:shotgun|12[\s-]?(?:g|ga|gauge|gage))\b).*\bpump\b/i,
    names: ["12-gauge Shotgun (Pump)"],
  },
  {
    re: /^(?!.*\b(?:10|16|20)[\s-]?(?:g|ga|gauge|gage)\b)(?=.*\b(?:shotgun|12[\s-]?(?:g|ga|gauge|gage))\b).*\bsemi[\s-]?auto(?:matic)?\b/i,
    names: ["12-gauge Shotgun (semi-auto)"],
  },
  { re: /\b10[\s-]?(?:g|ga|gauge|gage)\b/i, names: ["10-gauge Shotgun (2B)"] },
  { re: /\b12[\s-]?(?:g|ga|gauge|gage)\b/i, names: ["12-gauge Shotgun (2B)"] },
  { re: /\b16[\s-]?(?:g|ga|gauge|gage)\b/i, names: ["16-gauge Shotgun (2B)"] },
  { re: /\b20[\s-]?(?:g|ga|gauge|gage)\b/i, names: ["20-gauge Shotgun (2B)"] },
  {
    re: /^(?!.*\b\d{2}[\s-]?(?:g|ga|gauge|gage)\b).*\bshotgun\b/i,
    names: ["12-gauge Shotgun (2B)"],
  },
];

const RIFLE_RE =
  /\b(rifle|carbine|enfield|springfield|garand|mauser|winchester|musket)\b|-action\b/i;

// Ordered candidate canonical names for an attack: exact name, damage-based melee
// size, then firearm aliases (core name before its wiki fallback within each).
function weaponCandidates(attack: CombatEntry): string[] {
  const out: string[] = [attack.name];
  out.push(...meleeCandidates(attack));
  const isRifle = RIFLE_RE.test(attack.name);
  for (const rule of WEAPON_ALIASES) {
    if (rule.handgun && isRifle) continue;
    if (rule.re.test(attack.name)) out.push(...rule.names);
  }
  return out;
}

// Resolve an attack to a compendium weapon: the first candidate present in the
// weapon index wins (core preferred, wiki fallback). Null -> a custom weapon.
function matchWeapon(attack: CombatEntry, weaponIndex: ItemIndex): any | null {
  for (const cand of weaponCandidates(attack)) {
    const hit = weaponIndex.get(cand.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

// A weapon whose backing skill is resolved and attached in a second pass
// (attachCustomWeapons): a custom weapon (no compendium match), or a thrown
// compendium weapon (which should use the Throw skill, not its own).
interface CustomWeapon {
  weapon: any;
  value: number | null;
  ranged: boolean;
  thrown: boolean;
}

// A thrown weapon uses the Throw skill: recognised from the compendium weapon's
// "thrown" flag, or the stat block naming it ("(thrown)", "throwing", boomerang).
function isThrownAttack(attack: CombatEntry, matched: any | null): boolean {
  if (matched?.system?.properties?.thrown) return true;
  return /^throw\b|\(thrown\)|\(throw\)|throwing|boomerang|shuriken|javelin/i.test(
    attack.name,
  );
}

// A thrown weapon is a ranged weapon that ranges to STR/5 yards, matching the
// core "Rock, Thrown" profile. (The system's own `thrown` property is left
// false: it only swaps the roll to a weapon's *alternative* skill, but a thrown
// weapon's main skill already is Throw. Its half damage bonus is handled by the
// damage normalization, and its Throw skill is attached in the second pass.)
function applyThrownProfile(weapon: any): void {
  const sys = (weapon.system = weapon.system ?? {});
  sys.properties = sys.properties ?? {};
  sys.properties.rngd = true;
  sys.range = sys.range ?? {};
  sys.range.normal = sys.range.normal ?? {};
  sys.range.normal.value = "@STR/5";
}

function buildItems(
  character: CocCharacter,
  indexes: CompendiumIndexes,
): { base: any[]; customWeapons: CustomWeapon[] } {
  const base: any[] = [];
  const customWeapons: CustomWeapon[] = [];
  const skillNames = new Set<string>();

  const addSkill = (item: any) => {
    if (skillNames.has(item.name)) return;
    skillNames.add(item.name);
    base.push(item);
  };

  // Skills, with languages handled specially (own vs other; see languageItem).
  const langEntries: [string, number][] = [];
  for (const [name, value] of Object.entries(character.skills)) {
    if (isLanguageSkill(name)) langEntries.push([name, value]);
    else addSkill(skillItem(name, value, {}, indexes.skill));
  }
  // A language whose value equals EDU is the character's own (native) language;
  // its base is pinned to EDU ("@EDU"). Any other value — a foreign language, or
  // an own language with extra points invested (an English professor above EDU) —
  // is imported as an "other" language with its concrete value. That is both
  // simpler and more correct: pinning to EDU would drop those extra points, or
  // inflate a below-EDU value.
  const edu = character.characteristics.EDU?.value ?? null;
  for (const [name, value] of langEntries) {
    addSkill(
      languageItem(name, value, edu != null && value === edu, indexes.skill),
    );
  }

  // Combat: Dodge is a skill; anything else becomes a weapon. A non-thrown
  // compendium weapon is created now with its own backing skill; a thrown weapon
  // (compendium or custom) and any other custom weapon has its skill resolved in
  // the second pass, where a thrown weapon uses the actor's Throw skill.
  for (const printed of character.combat) {
    // "Fighting (Bite)" is a Bite attack made with Fighting: keep the attack's
    // own name; its skill is chosen like any other attack's.
    const skillNamed = /^fighting\s*\((.+)\)$/i.exec(printed.name.trim());
    const attack = skillNamed
      ? { ...printed, name: skillNamed[1].trim() }
      : printed;
    if (/^dodge$/i.test(attack.name)) {
      addSkill(skillItem("Dodge", attack.value ?? 0, {}, indexes.skill));
      continue;
    }
    const found = matchWeapon(attack, indexes.weapon);
    const thrown = isThrownAttack(attack, found);
    if (found && !thrown) {
      const weapon = structuredClone(found);
      delete weapon._id;
      // Keep the stat block's own name (so the keeper can cross-check against the
      // book) while taking the compendium weapon's stats, icon, and CoCID — but
      // the book's damage always wins over the compendium's.
      weapon.name = attack.name;
      overrideBookDamage(weapon, attack, character.derived.DB);
      const ranged = !!weapon.system?.properties?.rngd;
      const refs = [
        { ref: weapon.system?.skill?.main?.name, value: attack.value ?? 0 },
        { ref: weapon.system?.skill?.alternativ?.name, value: 0 },
      ];
      for (const { ref, value } of refs) {
        const skill = ref
          ? weaponSkillItem(ref, value, ranged, indexes.skill)
          : null;
        if (skill) addSkill(skill);
      }
      base.push(weapon);
    } else {
      let weapon: any;
      let ranged: boolean;
      if (found) {
        // Thrown compendium weapon: keep its stats and book name, but resolve the
        // Throw skill later instead of its own (Fighting) skill.
        weapon = structuredClone(found);
        delete weapon._id;
        weapon.name = attack.name;
        overrideBookDamage(weapon, attack, character.derived.DB);
        ranged = !!weapon.system?.properties?.rngd;
      } else {
        ranged = FIREARM_RE.test(attack.name);
        weapon = customWeaponData(attack, ranged, character.derived.DB);
      }
      if (thrown) applyThrownProfile(weapon);
      customWeapons.push({ weapon, value: attack.value, ranged, thrown });
    }
  }

  // Spells.
  for (const name of character.spells) {
    base.push(spellItem(name, indexes.spell));
  }

  // Carried gear (a pre-gen's "Possessions"/"Equipment" list) -> generic item
  // documents; the CoC7 "item" type defaults quantity to 1.
  for (const name of character.items) {
    base.push({ type: "item", name, system: {} });
  }

  return { base, customWeapons };
}

// Energy weapons ("Laser staff", "Death ray"), which are always firearms.
const ENERGY_WEAPON_RE = /\b(?:laser|ray|beam|blaster)\b/i;

const FIREARM_RE =
  /\b(revolver|pistol|rifle|shotgun|gun|firearm|automatic|carbine|derringer|colt|luger|mauser|musket|needle|bow|sling|thompson|tommy|smg|submachine|laser|ray|beam|blaster)\b|\.\d{2}\b/i;

// The Firearms specialization a custom firearm's name implies, or "" when the
// name doesn't say.
const FIREARM_CATEGORIES: [RegExp, string][] = [
  [/\b(?:thompson|tommy|smg|sub-?machine|mp[\s-]?\d{2})\b/i, "Submachine Gun"],
  [/\b(?:lewis|vickers|bren|machine[\s-]?gun)\b/i, "Machine Gun"],
  [/\b(?:bow|crossbow)\b/i, "Bow"],
  [
    /\b(?:rifle|carbine|shotgun|musket|elephant\s+gun|enfield|springfield|garand|winchester|staff)\b|\b\d{2}[\s-]?(?:g|ga|gauge|gage)\b/i,
    "Rifle/Shotgun",
  ],
  [
    /\b(?:revolver|pistol|automatic|auto|derringer|colt|luger|webley|nambu|handgun)\b|\.\d{2}\b/i,
    "Handgun",
  ],
];

// The Fighting specialization a custom melee weapon's name implies; anything
// else a human wields uses Brawl.
const FIGHTING_CATEGORIES: [RegExp, string][] = [
  [/\b(?:sword|sabre|saber|rapier|cutlass|katana|scimitar)\b/i, "Sword"],
  [/\b(?:axe|hatchet)\b/i, "Axe"],
  [/\b(?:spear|lance|javelin)\b/i, "Spear"],
  [/\bwhip\b/i, "Whip"],
  [/\bgarrott?e\b/i, "Garrote"],
  [/\bchainsaw\b/i, "Chainsaw"],
  [/\bflail\b/i, "Flail"],
];

// The most common value, the first-seen on a tie.
function mostCommon(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0];
  for (const v of values) if (counts.get(v)! > counts.get(best)!) best = v;
  return best;
}

// The skill category for a custom weapon: a creature's melee attacks all use
// its generic Fighting skill ("Fighting (Fighting)", as the system's creatures
// do); a human's use the weapon's own category or Brawl; a firearm uses the
// category its name implies, or "" (no category: a per-weapon skill).
function weaponCategory(
  name: string,
  ranged: boolean,
  creature: boolean,
): string {
  if (ranged)
    return FIREARM_CATEGORIES.find(([re]) => re.test(name))?.[1] ?? "";
  if (creature) return "Fighting";
  return FIGHTING_CATEGORIES.find(([re]) => re.test(name))?.[1] ?? "Brawl";
}

// Half of a damage bonus, matching CoC7Utilities.halfDB: halve each die's sides
// ("+1D6" -> "+1D3", "+2D6" -> "+2D3") and each flat term. Thrown weapons add it.
function halfDamageBonus(db: string): string {
  let f = db.replace(/\s+/g, "");
  if (!/^[+-]/.test(f)) f = "+" + f;
  return f.replace(/([+-])(\d+)(?:[dD](\d+))?/g, (_m, sign, n, sides) => {
    if (sides === undefined) {
      const v =
        sign === "-" ? Math.ceil(Number(n) / 2) : Math.floor(Number(n) / 2);
      return sign + v;
    }
    const half =
      sign === "-"
        ? Math.ceil(Number(sides) / 2)
        : Math.floor(Number(sides) / 2);
    return sign + n + "D" + half;
  });
}

// The leading dice-damage formula of a string, dropping any trailing prose
// ("2D8 per charge" -> "2D8", "1D6, victim must ..." -> "1D6"); supports a
// "/"-separated range spread ("4D6/2D6/1D6"). null when there is no dice term.
function leadingDamageFormula(d: string | null): string | null {
  const s = (d ?? "").replace(/\s+/g, "");
  const m = s.match(
    /^\d*[dD]\d+(?:[+-]\d+(?:[dD]\d+)?)*(?:\/\d*[dD]?\d+(?:[+-]\d+(?:[dD]\d+)?)?)*/,
  );
  return m ? m[0] : null;
}

// Normalise a weapon damage that inlines this actor's damage bonus. A stat block
// often writes the exact value ("1D4+1D6") instead of "+DB"; when the damage ends
// with the actor's DB, strip that trailing term and flag `addb` so the sheet adds
// the bonus itself — matching how the compendium (and the system's own importers)
// store it. A thrown weapon adds *half* the DB, so a trailing half-DB sets `ahdb`
// instead. The result is reduced to its clean dice formula; `valid` is false when
// the damage carries no dice term (pure prose), so the caller can decline it.
function normalizeWeaponDamage(
  damage: string | null,
  db: string | null,
): { damage: string; addb: boolean; ahdb: boolean; valid: boolean } {
  const raw = (damage ?? "").replace(/\s+/g, "");
  let base = raw;
  let addb = false;
  let ahdb = false;
  if (raw) {
    if (/\+DB$/i.test(raw)) {
      base = raw.replace(/\+DB$/i, "");
      addb = true;
    } else {
      const r = (db ?? "").trim();
      if (r && r !== "0" && r !== "+0") {
        const full = (/^[+-]/.test(r) ? r : "+" + r).replace(/\s+/g, "");
        const half = halfDamageBonus(full);
        const R = raw.toUpperCase();
        if (R.endsWith(full.toUpperCase())) {
          base = raw.slice(0, raw.length - full.length);
          addb = true;
        } else if (
          half.toUpperCase() !== full.toUpperCase() &&
          R.endsWith(half.toUpperCase())
        ) {
          base = raw.slice(0, raw.length - half.length);
          ahdb = true;
        }
      }
    }
  }
  const clean = leadingDamageFormula(base);
  return { damage: clean ?? "", addb, ahdb, valid: clean != null };
}

// Keep a matched compendium weapon's metadata (icon, skill, range, malfunction,
// impale, ...) but override its damage and add-DB flags with the book's own
// values, so imported damage never deviates from the source. A "/"-spread fills
// the normal/long/extreme range damages. When the book damage has no dice term,
// the compendium's damage is kept.
function overrideBookDamage(
  weapon: any,
  attack: CombatEntry,
  db: string | null,
): void {
  const { damage, addb, ahdb, valid } = normalizeWeaponDamage(
    attack.damage,
    db,
  );
  if (!valid) return;
  const sys = (weapon.system = weapon.system ?? {});
  const range = (sys.range = sys.range ?? {});
  const parts = damage.split("/");
  range.normal = { ...(range.normal ?? {}), damage: parts[0] ?? "" };
  if (parts.length > 1) {
    range.long = { ...(range.long ?? {}), damage: parts[1] ?? "" };
    range.extreme = { ...(range.extreme ?? {}), damage: parts[2] ?? "" };
  }
  sys.properties = sys.properties ?? {};
  sys.properties.addb = addb;
  sys.properties.ahdb = ahdb;
}

// Weapon document for a custom (non-compendium) attack. Its backing skill is
// filled in later by attachCustomWeapons (skill.main starts empty).
function customWeaponData(
  attack: CombatEntry,
  ranged: boolean,
  db: string | null,
): any {
  const maneuver = /\bman(?:oeuv|euv)re?\b|\bmnvr\b/i.test(attack.name);
  const { damage, addb, ahdb } = normalizeWeaponDamage(attack.damage, db);
  return {
    name: attack.name,
    type: "weapon",
    system: {
      skill: { main: { name: "", id: "" } },
      range: { normal: { value: "", damage } },
      properties: { rngd: ranged, mnvr: maneuver, addb, ahdb },
      description: {
        value: attack.note ? `<p>${escapeHtml(attack.note)}</p>` : "",
      },
    },
  };
}

// Resolve and attach a backing skill to each custom weapon, then create them.
// Algorithm:
//   1. Find the weapon's category skill (weaponCategory): "Firearms (Handgun)",
//      "Fighting (Brawl)", a creature's "Fighting (Fighting)", ...
//   2. Settle each category skill's value before assigning any weapon: the
//      actor's own skill of that name, else the attack named for the category
//      (a creature's "Fighting", a human's "Brawl"), else the most common value
//      among the category's weapons (the first, on a tie).
//   3. A weapon at that value uses the category skill. One at a different
//      value — or whose name implies no category — uses a per-weapon
//      "Fighting (weapon)" / "Firearms (weapon)" skill, so a printed
//      percentage is never lost.
//   4. Link the weapon to that skill by id, so the sheet doesn't prompt.
async function attachCustomWeapons(
  actor: any,
  customWeapons: CustomWeapon[],
  indexes: CompendiumIndexes,
  type: EntityType,
): Promise<void> {
  if (!customWeapons.length) return;

  const specFor = (ranged: boolean) =>
    localize(
      ranged
        ? "CoC7.FirearmSpecializationName"
        : "CoC7.FightingSpecializationName",
      ranged ? "Firearms" : "Fighting",
    );
  const specOf = (s: any) => s?.system?.specialization ?? "";
  const isThrow = (s: any) =>
    (s?.system?.skillName ?? s?.name ?? "").toLowerCase() === "throw";
  const baseOf = (s: any) =>
    Number(s?.system?.adjustments?.base ?? s?.system?.base);

  // Skills already on the actor after the base pass (includes any the compendium
  // weapons created), plus new skills we create in this pass.
  const existing = Array.from(actor.items ?? []).filter(
    (i: any) => i.type === "skill",
  );
  const newSkills: any[] = [];
  const resolved: { weapon: any; skill: any | null }[] = [];

  const named = (spec: string, skillName: string) => (s: any) =>
    specOf(s) === spec &&
    String(s?.system?.skillName ?? "").toLowerCase() ===
      skillName.toLowerCase();
  const find = (spec: string, skillName: string) =>
    existing.find(named(spec, skillName)) ??
    newSkills.find(named(spec, skillName));
  const add = (spec: string, skillName: string, v: number, ranged: boolean) => {
    const created = skillItem(
      specName(spec, skillName),
      v,
      { special: true, fighting: !ranged, firearm: ranged, ranged },
      indexes.skill,
    );
    newSkills.push(created);
    return created;
  };
  const rounded = (value: number) => Math.max(0, Math.round(value));
  // A thrown weapon has no category: if its value differs from Throw, it keeps
  // its own skill.
  const categoryOf = (w: CustomWeapon) =>
    w.thrown || w.value == null
      ? ""
      : weaponCategory(w.weapon.name, w.ranged, type === "creature");

  const groups = new Map<
    string,
    {
      spec: string;
      category: string;
      ranged: boolean;
      values: number[];
      generic: number | null;
    }
  >();
  for (const w of customWeapons) {
    const category = categoryOf(w);
    if (!category) continue;
    const spec = specFor(w.ranged);
    const key = `${spec}|${category}`;
    const group = groups.get(key) ?? {
      spec,
      category,
      ranged: w.ranged,
      values: [],
      generic: null,
    };
    const v = rounded(w.value!);
    group.values.push(v);
    if (
      group.generic == null &&
      w.weapon.name.trim().toLowerCase() === category.toLowerCase()
    )
      group.generic = v;
    groups.set(key, group);
  }
  for (const g of groups.values()) {
    if (find(g.spec, g.category)) continue;
    add(g.spec, g.category, g.generic ?? mostCommon(g.values), g.ranged);
  }

  for (const w of customWeapons) {
    const { weapon, value, ranged, thrown } = w;
    // No printed value ("Grab and Bite (mnvr) damage 1D6+6D6"): the attack
    // uses its category skill when the actor has one, and is left unlinked
    // otherwise.
    if (value == null) {
      const category = thrown
        ? ""
        : weaponCategory(weapon.name, ranged, type === "creature");
      resolved.push({
        weapon,
        skill: category ? (find(specFor(ranged), category) ?? null) : null,
      });
      continue;
    }
    const v = Math.max(0, Math.round(value));
    let skill: any = null;

    // A thrown weapon uses the actor's Throw skill — but only when its value
    // matches (or no Throw skill exists yet). If a Throw skill is already present
    // with a different value, fall through to a per-weapon Fighting skill.
    if (thrown) {
      const thr = existing.find(isThrow) ?? newSkills.find(isThrow);
      if (thr && baseOf(thr) === v) skill = thr;
      else if (!thr) {
        skill = skillItem("Throw", v, {}, indexes.skill);
        newSkills.push(skill);
      }
    }

    if (!skill) {
      const spec = specFor(ranged);
      const category = categoryOf(w);
      const held = category ? find(spec, category) : null;
      skill =
        held && baseOf(held) === v
          ? held
          : (find(spec, weapon.name) ?? add(spec, weapon.name, v, ranged));
    }
    resolved.push({ weapon, skill });
  }

  const createdSkills = newSkills.length
    ? ((await actor.createEmbeddedDocuments("Item", newSkills, {
        renderSheet: false,
      })) ?? [])
    : [];
  const createdByName = new Map(createdSkills.map((d: any) => [d.name, d]));

  const weapons = resolved.map(({ weapon, skill }) => {
    if (skill) {
      const doc =
        (skill.id ?? skill._id) ? skill : createdByName.get(skill.name);
      if (doc)
        weapon.system.skill.main = {
          id: doc.id ?? doc._id ?? "",
          name: doc.name,
        };
    }
    return weapon;
  });
  await actor.createEmbeddedDocuments("Item", weapons, { renderSheet: false });
}

// Resolve the backing skill a compendium weapon references. A CoCID reference is
// cloned from the exact skill it names. A plain skill *name* is cloned if it
// exists, otherwise built as a concrete named skill from the "(Any)" template —
// so a weapon whose skill ("Firearms (Lightning Gun)") doesn't exist in the world
// still gets that exact skill attached, instead of the system folding it into
// "(Any)" and prompting for a specialization.
function weaponSkillItem(
  ref: string,
  value: number,
  ranged: boolean,
  skillIndex: ItemIndex,
): any | null {
  if (/^i\.skill\./i.test(ref)) return skillFromRef(ref, value, skillIndex);
  return skillItem(
    ref,
    value,
    { special: true, fighting: !ranged, firearm: ranged, ranged },
    skillIndex,
  );
}

// Clone a compendium skill referenced by a weapon (by CoCID or name), setting its
// base to `value`. Returns null when the skill is not in the compendium (the
// weapon still references it by name and the sheet resolves it).
function skillFromRef(
  ref: string,
  value: number,
  skillIndex: ItemIndex,
): any | null {
  const found = findCompendiumItem(ref, skillIndex);
  if (!found) return null;
  const base = Math.max(0, Math.round(Number(value) || 0));
  const data = structuredClone(found);
  delete data._id;
  data.system = data.system ?? {};
  data.system.base = String(base);
  data.system.adjustments = { ...(data.system.adjustments ?? {}), base };
  if (data.system.properties) {
    data.system.properties.requiresname = false;
    data.system.properties.picknameonly = false;
  }
  setCocid(data, "skill");
  return data;
}

// A spell item: the compendium spell (with its description/era config) when one
// matches, otherwise a bare spell. Always stamped with its CoCID.
function spellItem(name: string, spellIndex: ItemIndex): any {
  const found = findCompendiumItem(name, spellIndex);
  let data: any;
  if (found) {
    data = structuredClone(found);
    delete data._id;
    data.name = name;
  } else {
    data = { type: "spell", name, system: {} };
  }
  setCocid(data, "spell");
  return data;
}

// A genuinely unspecialized skill (skillName "Any", e.g. "Science (Any)",
// "Language (Any)") still prompts for a specialization on the sheet — the system
// treats skillName === "Any" as unresolved. Import it as "(None)" instead
// (matching the CoC7 dholehouse/actor importers) so it lands as a concrete,
// non-prompting skill.
function deSpecializeAny(data: any): void {
  if ((data.system?.skillName ?? "").toLowerCase() !== "any") return;
  data.name = String(data.name).replace(/\s*\(\s*any\s*\)\s*$/i, " (None)");
  data.system.skillName = "None";
  data.system.properties = data.system.properties ?? {};
  data.system.properties.requiresname = false;
  data.system.properties.picknameonly = false;
}

// Build a CoC7 skill item. A name of the form "Spec (Name)" is split into its
// specialization + skillName; the percentage is stored as the base adjustment.
// When the skill (or its generic "(Any)" template) exists in the compendium, the
// real item is cloned so it keeps its CoCID, icon, and properties — only the base
// value (and, for a filled-in specialization, the name) is overridden.
function skillItem(
  fullName: string,
  value: number,
  extraProps: Record<string, boolean> = {},
  skillIndex?: ItemIndex,
): any {
  const match = fullName.match(/^([^(]+)\s*\((.+)\)$/);
  const specialization = match ? match[1].trim() : "";
  const skillName = match ? match[2].trim() : fullName;
  const name = specialization ? `${specialization} (${skillName})` : skillName;
  const base = Math.max(0, Math.round(Number(value) || 0));

  const found = skillIndex ? findCompendiumItem(name, skillIndex) : null;
  let data: any;
  if (found) {
    data = structuredClone(found);
    delete data._id;
    data.name = name;
    data.system = data.system ?? {};
    data.system.skillName = skillName;
    data.system.specialization = specialization;
    data.system.base = String(base);
    data.system.adjustments = { ...(data.system.adjustments ?? {}), base };
    // A cloned "(Any)" template must not re-prompt for a specialization name.
    if (data.system.properties) {
      data.system.properties.requiresname = false;
      data.system.properties.picknameonly = false;
      for (const [k, v] of Object.entries(extraProps))
        data.system.properties[k] = v;
    }
  } else {
    data = {
      type: "skill",
      name,
      system: {
        skillName,
        specialization,
        base: String(base),
        adjustments: { base },
        properties: { special: !!match, ...extraProps },
      },
    };
  }
  deSpecializeAny(data);
  setCocid(data, "skill");
  return data;
}

const LANGUAGE_ICON = "systems/CoC7/assets/icons/skills/language.svg";

// A language skill is our canonical "Language (X)" form (Own/Other/Any or a
// specific language).
function isLanguageSkill(name: string): boolean {
  return /^\s*language\s*\(/i.test(name);
}

// Build a language skill by cloning the own/other template — never the specific
// "Language (English)" item, which is ambiguous (it says nothing about whether
// the language is the character's own or another). The character's own (native)
// language clones "Language (Own)"; every other language clones "Language
// (Other)", falling back to "Language (Any)" when the module that provides
// "Other" is absent. The specific language name and value are then applied. With
// no compendium, a bare language skill carries the system icon.
function languageItem(
  name: string,
  value: number,
  isOwn: boolean,
  skillIndex: ItemIndex,
): any {
  const template =
    (isOwn ? skillIndex.get("language (own)") : undefined) ??
    skillIndex.get("language (other)") ??
    skillIndex.get("language (any)");

  let data: any;
  if (template) {
    data = structuredClone(template);
    delete data._id;
  } else {
    data = { type: "skill", img: LANGUAGE_ICON, system: { properties: {} } };
  }

  const m = name.match(/^([^(]+)\s*\((.+)\)$/);
  const specialization = m ? m[1].trim() : "Language";
  const skillName = m ? m[2].trim() : name;
  const base = Math.max(0, Math.round(Number(value) || 0));

  data.name = name;
  data.system = data.system ?? {};
  data.system.skillName = skillName;
  data.system.specialization = specialization;
  // The own (native) language tracks EDU via the CoC7 "@EDU" formula (as the
  // "Language (Own)" template does); every other language takes its parsed value.
  if (isOwn) {
    data.system.base = "@EDU";
  } else {
    data.system.base = String(base);
    data.system.adjustments = { ...(data.system.adjustments ?? {}), base };
  }
  data.system.properties = data.system.properties ?? {};
  data.system.properties.special = true;
  // We've named the specific language, so the sheet must not re-prompt for it.
  data.system.properties.requiresname = false;
  data.system.properties.picknameonly = false;
  deSpecializeAny(data); // "Language (Any)" -> "Language (None)"
  setCocid(data, "skill");
  return data;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Find or create a top-level Actor folder; a same-named nested folder is not it.
async function ensureActorFolder(name: string): Promise<any> {
  const existing = game.folders?.find(
    (f: any) =>
      f.name === name &&
      f.type === "Actor" &&
      (f.folder?.id ?? f.folder ?? null) === null,
  );
  if (existing) return existing;
  try {
    return await Folder.create({ name, type: "Actor" });
  } catch {
    return null;
  }
}

// Fields of a replaced actor that the Keeper owns rather than the book: they
// carry over to its replacement along with the id.
const KEPT_ACTOR_FIELDS = ["img", "prototypeToken", "ownership", "sort"];

// The actors already in `folder` that incoming characters will replace.
async function claimReplacedActors(
  folder: FoundryFolder | null,
  characters: CocCharacter[],
): Promise<{ take(character: CocCharacter): FoundryActor | null }> {
  const existing = folder?.id
    ? (game.actors?.filter((a) => a.folder?.id === folder.id) ?? [])
    : [];
  const claims = await claimReplaced(
    existing,
    characters.map((c) => c.name || "Unknown"),
  );
  return { take: (c) => claims.take(c.name || "Unknown") };
}

function localize(key: string, fallback: string): string {
  const value = game.i18n.localize(key);
  return !value || value === key ? fallback : value;
}

function specName(specialization: string, skillName: string): string {
  return `${specialization} (${skillName})`;
}

// Damage bonus for the actor sheet: strip a leading "+" ("+1D4" -> "1D4").
function normalizeDb(db: string): string {
  return String(db)
    .replace(/^\+\s*/, "")
    .trim();
}

// "1/1D6 Sanity points to see ..." -> { checkPassed: '1', checkFailled: '1D6' }.
function parseSanLoss(
  sanityLoss: string | null,
): { checkPassed: string; checkFailled: string } | null {
  if (!sanityLoss) return null;
  const match = sanityLoss.match(/^\s*([0-9dD+\-*/]+)\s*\/\s*([0-9dD+\-*/]+)/);
  if (!match) return null;
  return { checkPassed: match[1], checkFailled: match[2] };
}

// "1" / "up to 4 (...)" -> leading integer, or null.
function parseAttacksPerRound(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : null;
}

function notesToHtml(character: CocCharacter, type: EntityType): string {
  const parts: string[] = [];
  if (character.sanityLoss) parts.push(`Sanity loss: ${character.sanityLoss}`);
  for (const note of character.notes) parts.push(note);
  let html = parts
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");
  // A non-investigator (NPC/creature) has no backstory/biography on its sheet,
  // so its background sections would otherwise be dropped. Keep them in the
  // Keeper notes instead. (Investigators get them as backstory/biography.)
  if (type !== "character" && character.background.length) {
    html += backstoryHtml(character.background);
  }
  return html;
}

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
