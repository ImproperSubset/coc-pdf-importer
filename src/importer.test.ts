// Unit tests for the Foundry actor builder. Foundry's globals (game, ui, Actor,
// Folder) are replaced with a lightweight mock harness that records what would
// be created, so the CoC7 mapping can be checked without a running game.
//
// All character data here is generic placeholder text — no published content.
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { importCharacters } from "./importer.ts";
import type { Target } from "./target.ts";
import type { CocCharacter, Characteristics, CombatEntry } from "./process.ts";

// --- generic fixtures ------------------------------------------------------

function chars(values: Record<string, number | null>): Characteristics {
  const out: any = {};
  for (const [k, v] of Object.entries(values))
    out[k] = { value: v, raw: String(v), marked: false };
  return out;
}

function attack(name: string, over: Partial<CombatEntry> = {}): CombatEntry {
  return {
    name,
    value: 40,
    half: 20,
    fifth: 8,
    damage: "1D4",
    note: null,
    ...over,
  };
}

// A minimal compendium weapon document with the given canonical name.
function weaponDoc(name: string): any {
  return {
    name,
    type: "weapon",
    img: "weapon.svg",
    system: {
      skill: { main: { name: "Firearms (Handgun)" } },
      range: { normal: { damage: "1D10" } },
      properties: { rngd: true },
    },
    flags: {
      CoC7: {
        cocidFlag: {
          id: "i.weapon." + name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        },
      },
    },
  };
}

function makeCharacter(over: Partial<CocCharacter> = {}): CocCharacter {
  return {
    name: "Test Subject",
    age: 30,
    description: "",
    characteristics: {},
    derived: { DB: null, Build: null, Move: null, MP: null, Luck: null },
    attacksPerRound: null,
    combat: [],
    skills: {},
    spells: [],
    sanityLoss: null,
    armor: null,
    background: [],
    items: [],
    notes: [],
    ...over,
  };
}

// --- Foundry mock harness --------------------------------------------------

let created: any[];
let folders: any[];
let world: any[];
let notes: string[];

beforeEach(() => {
  created = [];
  folders = [];
  world = [];
  notes = [];
  let n = 0;
  (globalThis as any).game = {
    i18n: { localize: (k: string) => k, format: (k: string) => k },
    folders: {
      find: (p: any) => folders.find(p),
      filter: (p: any) => folders.filter(p),
    },
    actors: { filter: (p: any) => world.filter(p) },
    settings: { registerMenu() {} },
  };
  (globalThis as any).ui = {
    notifications: {
      info: (m: string) => notes.push(m),
      error: (m: string) => notes.push(m),
    },
  };
  (globalThis as any).Folder = {
    create: async (d: any, opts?: { pack?: string }) => {
      const f: any = { id: "f" + ++n, ...d, pack: opts?.pack };
      f.update = async (u: any) => Object.assign(f, u);
      folders.push(f);
      return f;
    },
  };
  (globalThis as any).Actor = {
    // Mirror Foundry: `keepId` creates the actor under the given `_id`.
    create: async (d: any, opts?: { keepId?: boolean; pack?: string }) => {
      const a: any = {
        ...d,
        pack: opts?.pack,
        id: opts?.keepId && d._id ? d._id : "a" + ++n,
        items: [],
        updates: [],
        deleted: false,
      };
      a.createEmbeddedDocuments = async (
        _type: string,
        docs: any[],
        opts?: { keepId?: boolean },
      ) => {
        // Mirror Foundry: assign ids (or keep the given ones with `keepId`)
        // and return the created documents.
        const withIds = docs.map((doc: any) => {
          const id = opts?.keepId && doc._id ? doc._id : "it" + ++n;
          return { ...doc, _id: id, id };
        });
        a.items.push(...withIds);
        return withIds;
      };
      a.update = async (u: any) => a.updates.push(u);
      a.delete = async () => {
        a.deleted = true;
        world.splice(world.indexOf(a), 1);
      };
      a.toObject = () => ({ ...d, _id: a.id });
      created.push(a);
      world.push(a);
      return a;
    },
  };
});

afterEach(() => {
  for (const k of ["game", "ui", "Actor", "Folder"])
    delete (globalThis as any)[k];
});

const item = (a: any, name: string) =>
  a.items.find((i: any) => i.name === name);

// --- tests -----------------------------------------------------------------

describe("importCharacters — system data", () => {
  test("maps characteristics, attribs, and infos into CoC7 system data", async () => {
    await importCharacters(
      [
        makeCharacter({
          characteristics: chars({
            STR: 60,
            CON: 55,
            SIZ: 65,
            DEX: 50,
            INT: 70,
            APP: 45,
            POW: 40,
            EDU: 80,
            SAN: 40,
            HP: 12,
          }),
          derived: { DB: "+1D4", Build: 1, Move: 8, MP: 8, Luck: 55 },
          age: 42,
          description: "night watchman",
        }),
      ],
      { notify: false },
    );
    const s = created[0].system;
    assert.equal(s.characteristics.str.value, 60);
    assert.equal(s.characteristics.edu.value, 80);
    assert.equal(s.characteristics.san, undefined); // SAN/HP are attribs, not chars
    assert.equal(s.attribs.san.value, 40);
    assert.equal(s.attribs.hp.value, 12);
    assert.equal(s.attribs.mp.value, 8);
    assert.equal(s.attribs.mov.value, 8);
    assert.equal(s.attribs.build.value, 1);
    assert.equal(s.attribs.lck.value, 55);
    assert.equal(s.attribs.db.value, "1D4"); // "+1D4" -> "1D4"
    assert.equal(s.infos.age, "42");
    assert.equal(s.infos.occupation, "night watchman");
  });

  test("omits attribs that are absent from the stat block", async () => {
    await importCharacters(
      [makeCharacter({ characteristics: chars({ STR: 50 }) })],
      { notify: false },
    );
    const s = created[0].system;
    assert.equal(s.attribs.mp, undefined);
    assert.equal(s.attribs.lck, undefined);
    assert.equal(s.attribs.db, undefined);
  });

  test("sanity-loss dice split into special.sanLoss", async () => {
    await importCharacters(
      [makeCharacter({ sanityLoss: "1/1D6 Sanity points to see it" })],
      { notify: false },
    );
    assert.deepEqual(created[0].system.special.sanLoss, {
      checkPassed: "1",
      checkFailled: "1D6",
    });
  });

  test("attacks-per-round parses to a leading integer", async () => {
    await importCharacters(
      [makeCharacter({ attacksPerRound: "up to 4 (tendril or consume)" })],
      { notify: false },
    );
    assert.equal(created[0].system.special.attacksPerRound, 4);
  });

  test("armor maps to attribs.armor (points value + full notes)", async () => {
    await importCharacters(
      [makeCharacter({ armor: "3-point fur and gristle" })],
      { notify: false },
    );
    const armor = created[0].system.attribs.armor;
    assert.equal(armor.value, 3);
    assert.equal(armor.auto, false);
    assert.equal(armor.notes, "3-point fur and gristle");
  });

  test("prose armor (no point value) maps to 0 with notes preserved", async () => {
    await importCharacters(
      [makeCharacter({ armor: "none, but immune to fire" })],
      { notify: false },
    );
    const armor = created[0].system.attribs.armor;
    assert.equal(armor.value, 0);
    assert.equal(armor.notes, "none, but immune to fire");
  });

  test("sanity loss and notes are escaped into the keeper description", async () => {
    await importCharacters(
      [
        makeCharacter({
          sanityLoss: "1/1D6 to see it",
          notes: ["kept a <secret> & a lie"],
        }),
      ],
      { notify: false },
    );
    const html = created[0].system.description.keeper;
    assert.match(html, /Sanity loss: 1\/1D6 to see it/);
    assert.match(html, /kept a &lt;secret&gt; &amp; a lie/);
  });

  test("imported HP/MP override the auto-derived values", async () => {
    await importCharacters(
      [
        makeCharacter({
          characteristics: chars({ HP: 12 }),
          derived: { DB: null, Build: null, Move: null, MP: 15, Luck: null },
        }),
      ],
      { notify: false },
    );
    const u = created[0].updates[0];
    assert.equal(u["system.attribs.hp.auto"], false);
    assert.equal(u["system.attribs.hp.value"], 12);
    assert.equal(u["system.attribs.mp.value"], 15);
  });
});

describe("importCharacters — entity type", () => {
  test("a creature's descriptor is its Type; an NPC's its Occupation", async () => {
    await importCharacters(
      [
        makeCharacter({ name: "Thug", description: "night watchman" }),
        makeCharacter({
          name: "Monster",
          description: "giant test lizard",
          sanityLoss: "0/1D6",
        }),
      ],
      { notify: false },
    );
    const thug = created.find((a) => a.name === "Thug").system.infos;
    const monster = created.find((a) => a.name === "Monster").system.infos;
    assert.equal(thug.occupation, "night watchman");
    assert.equal(thug.type, undefined);
    assert.equal(monster.type, "giant test lizard");
    assert.equal(monster.occupation, undefined);
  });

  test("NPCs' and creatures' empty Notes panels start closed", async () => {
    await importCharacters(
      [
        makeCharacter({ name: "Thug" }),
        makeCharacter({ name: "Monster", sanityLoss: "1/1D6" }),
      ],
      { notify: false },
    );
    for (const a of created) assert.equal(a.system.flags.panelNotes, false);
  });

  test("NPCs and creatures are created locked", async () => {
    await importCharacters(
      [
        makeCharacter({ name: "Thug" }),
        makeCharacter({ name: "Monster", sanityLoss: "1/1D6" }),
      ],
      { notify: false },
    );
    assert.equal(
      created.find((a) => a.name === "Thug").system.flags.locked,
      true,
    );
    assert.equal(
      created.find((a) => a.name === "Monster").system.flags.locked,
      true,
    );
  });

  test("a Sanity-loss stat block is a creature; otherwise an NPC", async () => {
    await importCharacters(
      [
        makeCharacter({ name: "Human", sanityLoss: null }),
        makeCharacter({ name: "Monster", sanityLoss: "1/1D6 to see it" }),
      ],
      { notify: false },
    );
    assert.equal(created.find((a) => a.name === "Human").type, "npc");
    assert.equal(created.find((a) => a.name === "Monster").type, "creature");
  });

  test("a background block makes the actor an Investigator (character)", async () => {
    await importCharacters(
      [
        makeCharacter({
          name: "Sleuth",
          age: 40,
          background: [
            { title: "Traits", text: "Curious & stubborn." },
            { title: "Significant People", text: "Justice above all." },
          ],
        }),
      ],
      { notify: false },
    );
    const a = created[0];
    assert.equal(a.type, "character");
    // The Investigator sheet has no npc-style "special" block.
    assert.equal(a.system.special, undefined);
    // Backstory HTML block + per-section biography rows (escaped).
    assert.match(a.system.backstory, /<h3>Traits<\/h3>/);
    assert.match(a.system.backstory, /Curious &amp; stubborn\./);
    assert.deepEqual(a.system.biography, [
      { title: "Traits", value: "<p>Curious &amp; stubborn.</p>" },
      { title: "Significant People", value: "<p>Justice above all.</p>" },
    ]);
  });

  test("a pregen with no parsed age is still an Investigator via its gear list", async () => {
    await importCharacters(
      [
        makeCharacter({
          name: "Gearhead",
          age: null,
          items: ["notebook", "fountain pen"],
          background: [{ title: "Treasured Possession", text: "a locket" }],
        }),
      ],
      { notify: false },
    );
    assert.equal(created[0].type, "character");
  });

  test("a background without an age or a ties section stays an NPC", async () => {
    // Scenario NPC / villain profile: a description + traits blurb but no age
    // and none of the investigator "ties to the world" sections.
    await importCharacters(
      [
        makeCharacter({
          name: "Villain",
          age: null,
          background: [
            { title: "Personal Description", text: "Tall, gaunt, cold-eyed." },
            { title: "Traits", text: "Ruthless." },
          ],
        }),
      ],
      { notify: false },
    );
    const a = created[0];
    assert.equal(a.type, "npc");
    // Not an investigator sheet: no backstory/biography...
    assert.equal(a.system.backstory, undefined);
    assert.equal(a.system.biography, undefined);
    // ...but the background sections are kept in the Keeper notes.
    assert.match(a.system.description.keeper, /<h3>Personal Description<\/h3>/);
    assert.match(a.system.description.keeper, /Tall, gaunt, cold-eyed\./);
    assert.match(a.system.description.keeper, /<h3>Traits<\/h3>/);
  });

  test("an explicit entity option overrides the guess", async () => {
    await importCharacters([makeCharacter({ sanityLoss: "1/1D6" })], {
      entity: "npc",
      notify: false,
    });
    assert.equal(created[0].type, "npc");
  });

  test("an empty name falls back to Unknown", async () => {
    await importCharacters([makeCharacter({ name: "" })], { notify: false });
    assert.equal(created[0].name, "Unknown");
  });
});

describe("importCharacters — items", () => {
  test("skills (including languages) become skill items", async () => {
    await importCharacters(
      [
        makeCharacter({
          skills: {
            "Spot Hidden": 45,
            "Science (Biology)": 30,
            "Language (Latin)": 25,
          },
        }),
      ],
      { notify: false },
    );
    const a = created[0];
    assert.equal(item(a, "Spot Hidden").type, "skill");
    assert.equal(item(a, "Spot Hidden").system.base, "45");
    const bio = item(a, "Science (Biology)");
    assert.equal(bio.system.specialization, "Science");
    assert.equal(bio.system.skillName, "Biology");
    assert.equal(bio.system.properties.special, true);
    const lang = item(a, "Language (Latin)");
    assert.ok(lang, "language skill created");
    assert.equal(lang.system.skillName, "Latin");
  });

  test("combat entries become weapons backed by fighting/firearm skills", async () => {
    await importCharacters(
      [
        makeCharacter({
          combat: [
            attack("Brawl", { value: 40, damage: "1D3" }),
            attack(".38 revolver", { value: 35, damage: "1D10" }),
          ],
        }),
      ],
      { notify: false },
    );
    const a = created[0];
    const brawl = a.items.find(
      (i: any) => i.type === "weapon" && i.name === "Brawl",
    );
    assert.equal(brawl.system.range.normal.damage, "1D3");
    assert.equal(brawl.system.properties.rngd, false);
    assert.equal(item(a, "Fighting (Brawl)").system.properties.fighting, true);
    const rev = a.items.find(
      (i: any) => i.type === "weapon" && i.name === ".38 revolver",
    );
    assert.equal(rev.system.properties.rngd, true);
    assert.equal(item(a, "Firearms (Handgun)").system.properties.firearm, true);
  });

  test("Dodge is a skill, not a weapon", async () => {
    await importCharacters(
      [
        makeCharacter({
          combat: [attack("Dodge", { value: 50, damage: null })],
        }),
      ],
      { notify: false },
    );
    const dodge = item(created[0], "Dodge");
    assert.equal(dodge.type, "skill");
    assert.equal(dodge.system.base, "50");
    assert.ok(
      !created[0].items.some(
        (i: any) => i.type === "weapon" && i.name === "Dodge",
      ),
    );
  });

  test("a maneuver attack sets the mnvr property", async () => {
    await importCharacters(
      [makeCharacter({ combat: [attack("Grab (mnvr)", { damage: "1D6" })] })],
      { notify: false },
    );
    const w = created[0].items.find((i: any) => i.type === "weapon");
    assert.equal(w.system.properties.mnvr, true);
  });

  test("a combat note is escaped into the weapon description", async () => {
    await importCharacters(
      [
        makeCharacter({
          combat: [
            attack("Knife", { damage: "1D4", note: "in <boot> & sheath" }),
          ],
        }),
      ],
      { notify: false },
    );
    assert.equal(
      item(created[0], "Knife").system.description.value,
      "<p>in &lt;boot&gt; &amp; sheath</p>",
    );
  });

  test("an attack rule's label is bold in the Keeper notes", async () => {
    await importCharacters(
      [
        makeCharacter({
          notes: ["**Bite & hold:** a <CON> roll.", "Plain note."],
        }),
      ],
      { notify: false },
    );
    const keeper = created[0].system.description.keeper;
    assert.match(
      keeper,
      /<p><strong>Bite &amp; hold:<\/strong> a &lt;CON&gt; roll\.<\/p>/,
    );
    assert.match(keeper, /<p>Plain note\.<\/p>/);
  });

  test("a bullet's label is bold in the Keeper notes", async () => {
    await importCharacters(
      [makeCharacter({ notes: ["Testa.\n\n• Traits: counts <doors>."] })],
      { notify: false },
    );
    assert.match(
      created[0].system.description.keeper,
      /<p>• <strong>Traits:<\/strong> counts &lt;doors&gt;\.<\/p>/,
    );
  });

  test("an attack's rule closes its weapon's description", async () => {
    await importCharacters(
      [
        makeCharacter({
          combat: [
            {
              ...attack("Knife", { damage: "1D4", note: "held" }),
              rule: "a <keen> & cruel blade.",
            },
          ],
        }),
      ],
      { notify: false },
    );
    assert.equal(
      item(created[0], "Knife").system.description.value,
      "<p>held</p><p>a &lt;keen&gt; &amp; cruel blade.</p>",
    );
  });

  test("a custom weapon's backing skill is created and linked by id", async () => {
    await importCharacters(
      [
        makeCharacter({
          combat: [attack("lightning gun", { value: 55, damage: "2D6" })],
        }),
      ],
      { notify: false },
    );
    const a = created[0];
    const weapon = a.items.find(
      (i: any) => i.type === "weapon" && i.name === "lightning gun",
    );
    const skill = a.items.find(
      (i: any) => i.type === "skill" && i.name === "Firearms (lightning gun)",
    );
    assert.ok(skill, "backing skill created");
    assert.equal(skill.system.base, "55");
    // Linked by id so the sheet does not pop a "select weapon skill" modal.
    assert.equal(weapon.system.skill.main.id, skill.id);
    assert.equal(weapon.system.skill.main.name, "Firearms (lightning gun)");
  });

  test("custom weapons of one category at the same value share one skill", async () => {
    await importCharacters(
      [
        makeCharacter({
          combat: [
            attack(".38 auto", { value: 50, damage: "1D10" }),
            attack("plasma pistol", { value: 50, damage: "1D10" }),
          ],
        }),
      ],
      { notify: false },
    );
    const a = created[0];
    const firearms = a.items.filter(
      (i: any) => i.type === "skill" && i.system.specialization === "Firearms",
    );
    assert.deepEqual(
      firearms.map((f: any) => f.name),
      ["Firearms (Handgun)"],
    );
    const weapons = a.items.filter((i: any) => i.type === "weapon");
    assert.equal(weapons.length, 2);
    for (const w of weapons)
      assert.equal(w.system.skill.main.id, firearms[0].id);
  });

  // The backing skill name of each weapon on the first created actor.
  const skillOf = (name: string) =>
    created[0].items.find((i: any) => i.type === "weapon" && i.name === name)
      ?.system.skill.main.name;
  const skillBase = (name: string) =>
    created[0].items.find((i: any) => i.type === "skill" && i.name === name)
      ?.system.base;

  test("custom firearms take the skill their category implies", async () => {
    await importCharacters(
      [
        makeCharacter({
          combat: [
            attack(".38 auto", { value: 45, damage: "1D10" }),
            attack(".303 rifle", { value: 50, damage: "2D6+4" }),
            attack("Thompson SMG", { value: 40, damage: "1D10+2" }),
            attack("Lewis gun", { value: 30, damage: "2D6+4" }),
            attack("Long bow", { value: 35, damage: "1D8" }),
            attack("lightning gun", { value: 55, damage: "2D6" }),
          ],
        }),
      ],
      { notify: false },
    );
    assert.equal(skillOf(".38 auto"), "Firearms (Handgun)");
    assert.equal(skillOf(".303 rifle"), "Firearms (Rifle/Shotgun)");
    assert.equal(skillOf("Thompson SMG"), "Firearms (Submachine Gun)");
    assert.equal(skillOf("Lewis gun"), "Firearms (Machine Gun)");
    assert.equal(skillOf("Long bow"), "Firearms (Bow)");
    assert.equal(skillOf("lightning gun"), "Firearms (lightning gun)"); // no category
    const thompson = created[0].items.find(
      (i: any) => i.type === "weapon" && i.name === "Thompson SMG",
    );
    assert.equal(thompson.system.properties.rngd, true); // a firearm, not melee
  });

  test("a human's custom melee weapons take their category or Brawl", async () => {
    await importCharacters(
      [
        makeCharacter({
          combat: [
            attack("Brawl", { value: 50, damage: "1D3" }),
            attack("Knife", { value: 50, damage: "1D4" }),
            attack("Cavalry sabre", { value: 40, damage: "1D8" }),
            attack("Hatchet", { value: 35, damage: "1D6" }),
          ],
        }),
      ],
      { notify: false },
    );
    assert.equal(skillOf("Brawl"), "Fighting (Brawl)");
    assert.equal(skillOf("Knife"), "Fighting (Brawl)");
    assert.equal(skillOf("Cavalry sabre"), "Fighting (Sword)");
    assert.equal(skillOf("Hatchet"), "Fighting (Axe)");
  });

  test("a custom weapon printed at a different value gets its own skill", async () => {
    await importCharacters(
      [
        makeCharacter({
          combat: [
            attack(".38 auto", { value: 45, damage: "1D10" }),
            attack(".32 revolver", { value: 30, damage: "1D8" }),
          ],
        }),
      ],
      { notify: false },
    );
    assert.equal(skillOf(".38 auto"), "Firearms (Handgun)");
    assert.equal(skillBase("Firearms (Handgun)"), "45");
    assert.equal(skillOf(".32 revolver"), "Firearms (.32 revolver)");
    assert.equal(skillBase("Firearms (.32 revolver)"), "30");
  });

  test("a creature's named attacks are separate weapons on its Fighting skill", async () => {
    await importCharacters(
      [
        makeCharacter({
          sanityLoss: "1/1D6",
          combat: [
            attack("Bite", { value: 60, damage: "1D6" }),
            attack("Engulf (mnvr)", { value: 60, damage: null }),
            attack("Tail sweep", { value: 60, damage: "8D6" }),
          ],
        }),
      ],
      { notify: false },
    );
    const weapons = created[0].items.filter((i: any) => i.type === "weapon");
    assert.deepEqual(
      weapons.map((w: any) => [w.name, w.system.range.normal.damage]),
      [
        ["Bite", "1D6"],
        ["Engulf (mnvr)", ""],
        ["Tail sweep", "8D6"],
      ],
    );
    for (const w of weapons)
      assert.equal(w.system.skill.main.name, "Fighting (Fighting)");
    const fighting = created[0].items.filter(
      (i: any) => i.type === "skill" && i.system.specialization === "Fighting",
    );
    assert.equal(fighting.length, 1); // one shared skill, no "Fighting (Bite)"
    assert.equal(fighting[0].system.base, "60");
  });

  test("a creature's generic Fighting attack sets the skill, wherever it is listed", async () => {
    await importCharacters(
      [
        makeCharacter({
          sanityLoss: "1/1D6",
          combat: [
            attack("Squeeze", { value: 80, damage: "5D6" }),
            attack("Fighting", { value: 75, damage: "2D6" }),
            attack("Hold (mnvr)", { value: 75, damage: null }),
          ],
        }),
      ],
      { notify: false },
    );
    assert.equal(skillOf("Fighting"), "Fighting (Fighting)");
    assert.equal(skillBase("Fighting (Fighting)"), "75");
    assert.equal(skillOf("Hold (mnvr)"), "Fighting (Fighting)");
    assert.equal(skillOf("Squeeze"), "Fighting (Squeeze)");
    assert.equal(skillBase("Fighting (Squeeze)"), "80");
  });

  test("without a generic attack, the most common value sets the skill", async () => {
    await importCharacters(
      [
        makeCharacter({
          sanityLoss: "1/1D6",
          combat: [
            attack("Bite", { value: 50, damage: "1D6" }),
            attack("Claws", { value: 60, damage: "1D8" }),
            attack("Tail", { value: 60, damage: "2D6" }),
          ],
        }),
      ],
      { notify: false },
    );
    assert.equal(skillBase("Fighting (Fighting)"), "60");
    assert.equal(skillOf("Claws"), "Fighting (Fighting)");
    assert.equal(skillOf("Tail"), "Fighting (Fighting)");
    assert.equal(skillOf("Bite"), "Fighting (Bite)");
  });

  test("an attack with no printed value uses the category skill", async () => {
    await importCharacters(
      [
        makeCharacter({
          sanityLoss: "1/1D6",
          combat: [
            attack("Fighting", { value: 50, damage: "2D6" }),
            attack("Seize and Gnaw (mnvr)", { value: null, damage: "1D6" }),
          ],
        }),
      ],
      { notify: false },
    );
    assert.equal(skillOf("Seize and Gnaw (mnvr)"), "Fighting (Fighting)");
  });

  test("an attack printed as 'Fighting (X)' is a weapon named X", async () => {
    await importCharacters(
      [
        makeCharacter({
          sanityLoss: "1/1D6",
          combat: [attack("Fighting (Bite)", { value: 50, damage: "1D6" })],
        }),
        makeCharacter({
          name: "Thug",
          combat: [attack("Fighting (Brawl)", { value: 55, damage: "1D3" })],
        }),
      ],
      { notify: false },
    );
    const bite = created[0].items.find((i: any) => i.type === "weapon");
    assert.equal(bite.name, "Bite");
    assert.equal(bite.system.skill.main.name, "Fighting (Fighting)");
    const brawl = created[1].items.find((i: any) => i.type === "weapon");
    assert.equal(brawl.name, "Brawl");
    assert.equal(brawl.system.skill.main.name, "Fighting (Brawl)");
    assert.ok(
      !created[1].items.some(
        (i: any) => i.name === "Fighting (Fighting (Brawl))",
      ),
    );
  });

  test("a custom weapon reuses a matching skill already on the actor", async () => {
    await importCharacters(
      [
        makeCharacter({
          skills: { "Firearms (Handgun)": 45 },
          combat: [attack("snubnose revolver", { value: 45, damage: "1D10" })],
        }),
      ],
      { notify: false },
    );
    const a = created[0];
    // No new firearms skill: the weapon reuses "Firearms (Handgun)".
    const firearms = a.items.filter(
      (i: any) => i.type === "skill" && i.system.specialization === "Firearms",
    );
    assert.equal(firearms.length, 1);
    assert.equal(firearms[0].name, "Firearms (Handgun)");
    const weapon = a.items.find((i: any) => i.type === "weapon");
    assert.equal(weapon.system.skill.main.id, firearms[0].id);
  });

  test("an abbreviated firearm matches the compendium weapon but keeps its book name", async () => {
    mockCompendium({
      weapons: [
        weaponDoc(".38 or 9mm Revolver"),
        weaponDoc(".45 Automatic"),
        weaponDoc("12-gauge Shotgun (2B)"),
      ],
    });
    await importCharacters(
      [
        makeCharacter({
          combat: [
            attack(".38 revolver", { value: 45, damage: "1D10" }),
            attack(".45 auto", { value: 40, damage: "1D10+2" }),
            attack("12-g shotgun", { value: 40, damage: "4D6/2D6/1D6" }),
          ],
        }),
      ],
      { notify: false },
    );
    const weapons = created[0].items.filter((i: any) => i.type === "weapon");
    // The stat block's own names are kept...
    assert.deepEqual(weapons.map((w: any) => w.name).sort(), [
      ".38 revolver",
      ".45 auto",
      "12-g shotgun",
    ]);
    // ...but the matched compendium weapon supplied the icon and CoCID identity.
    const rev = weapons.find((w: any) => w.name === ".38 revolver");
    assert.equal(rev.img, "weapon.svg");
    assert.match(rev.flags.CoC7.cocidFlag.id, /9mm-revolver/);
  });

  test("a matched firearm with a magazine is created loaded", async () => {
    const pistol = weaponDoc(".45 Automatic");
    pistol.system.bullets = 7;
    pistol.system.ammo = 0;
    mockCompendium({ weapons: [pistol] });
    await importCharacters(
      [makeCharacter({ combat: [attack(".45 auto", { value: 40 })] })],
      { notify: false },
    );
    const w = created[0].items.find((i: any) => i.type === "weapon");
    assert.equal(w.system.ammo, 7);
  });

  test("shotguns alias to the compendium entry for their gauge and variant", async () => {
    const shotguns = [
      "10-gauge Shotgun (2B)",
      "12-gauge Shotgun (2B)",
      "12-gauge Shotgun (2B sawed off)",
      "12-gauge Shotgun (Pump)",
      "12-gauge Shotgun (semi-auto)",
      "16-gauge Shotgun (2B)",
      "20-gauge Shotgun (2B)",
    ];
    mockCompendium({ weapons: shotguns.map(weaponDoc) });
    const cases: [string, string][] = [
      ["Shotgun", "12-gauge Shotgun (2B)"],
      ["12g shotgun", "12-gauge Shotgun (2B)"],
      ["10-gauge shotgun", "10-gauge Shotgun (2B)"],
      ["16 ga shotgun", "16-gauge Shotgun (2B)"],
      ["20-g shotgun", "20-gauge Shotgun (2B)"],
      ["Sawed-off shotgun", "12-gauge Shotgun (2B sawed off)"],
      ["Sawn-off 12-gauge", "12-gauge Shotgun (2B sawed off)"],
      ["Pump shotgun", "12-gauge Shotgun (Pump)"],
      ["12-gauge pump-action", "12-gauge Shotgun (Pump)"],
      ["Semi-automatic shotgun", "12-gauge Shotgun (semi-auto)"],
      ["20-gauge pump shotgun", "20-gauge Shotgun (2B)"], // no 20-gauge pump
    ];
    await importCharacters(
      [
        makeCharacter({
          combat: cases.map(([name]) =>
            attack(name, { value: 40, damage: "4D6/2D6/1D6" }),
          ),
        }),
      ],
      { notify: false },
    );
    for (const [name, expected] of cases) {
      const w = created[0].items.find((i: any) => i.name === name);
      assert.equal(
        w?.flags?.CoC7?.cocidFlag?.id,
        weaponDoc(expected).flags.CoC7.cocidFlag.id,
        name,
      );
    }
  });

  test("a pump-action rifle is not taken for a pump shotgun", async () => {
    mockCompendium({ weapons: [weaponDoc("12-gauge Shotgun (Pump)")] });
    await importCharacters(
      [
        makeCharacter({
          combat: [attack("Pump-action rifle", { value: 40, damage: "2D6" })],
        }),
      ],
      { notify: false },
    );
    const w = created[0].items.find((i: any) => i.type === "weapon");
    assert.notEqual(
      w.flags?.CoC7?.cocidFlag?.id,
      weaponDoc("12-gauge Shotgun (Pump)").flags.CoC7.cocidFlag.id,
    );
  });

  test("Thompson prefers the core 50-mag weapon, then the wiki fallback", async () => {
    mockCompendium({
      weapons: [weaponDoc("Thompson (50 mag)"), weaponDoc("Thompson")],
    });
    await importCharacters(
      [
        makeCharacter({
          combat: [attack("Thompson SMG", { value: 45, damage: "1D10+2" })],
        }),
      ],
      { notify: false },
    );
    const w = created[0].items.find((i: any) => i.type === "weapon");
    assert.equal(w.name, "Thompson SMG"); // book name kept
    assert.match(w.flags.CoC7.cocidFlag.id, /thompson-50-mag/); // core weapon used

    created.length = 0;
    mockCompendium({ weapons: [weaponDoc("Thompson")] }); // only the wiki pack
    await importCharacters(
      [
        makeCharacter({
          combat: [
            attack("Thompson submachine gun", { value: 45, damage: "1D10+2" }),
          ],
        }),
      ],
      { notify: false },
    );
    const w2 = created[0].items.find((i: any) => i.type === "weapon");
    assert.equal(w2.name, "Thompson submachine gun");
    assert.equal(w2.flags.CoC7.cocidFlag.id, "i.weapon.thompson"); // wiki fallback
  });

  test("a weapon flagged only for other eras still matches", async () => {
    mockCompendium({ otherEraWeapons: [weaponDoc(".38 Automatic")] });
    await importCharacters(
      [
        makeCharacter({
          combat: [attack(".38 auto", { value: 45, damage: "1D10" })],
        }),
      ],
      { notify: false },
    );
    const w = created[0].items.find((i: any) => i.type === "weapon");
    assert.equal(w.name, ".38 auto");
    assert.equal(
      w.flags.CoC7.cocidFlag.id,
      weaponDoc(".38 Automatic").flags.CoC7.cocidFlag.id,
    );
  });

  test("an era match wins over a same-named other-era weapon", async () => {
    const other = { ...weaponDoc(".38 Automatic"), img: "other-era.svg" };
    other.flags = { CoC7: { cocidFlag: { id: "i.weapon.38-automatic-core" } } };
    mockCompendium({
      weapons: [{ ...weaponDoc(".38 Automatic"), img: "era.svg" }],
      otherEraWeapons: [other],
    });
    await importCharacters(
      [
        makeCharacter({
          combat: [attack(".38 auto", { value: 45, damage: "1D10" })],
        }),
      ],
      { notify: false },
    );
    const w = created[0].items.find((i: any) => i.type === "weapon");
    assert.equal(w.img, "era.svg");
  });

  test("an other-era weapon in the world's language is preferred", async () => {
    const inLang = (lang: string) => {
      const d = { ...weaponDoc(".38 Automatic"), img: `${lang}.svg` };
      d.flags = { CoC7: { cocidFlag: { id: "i.weapon.38-automatic", lang } } };
      return d;
    };
    (globalThis as any).game.i18n.lang = "en";
    mockCompendium({ otherEraWeapons: [inLang("fr"), inLang("en")] });
    await importCharacters(
      [
        makeCharacter({
          combat: [attack(".38 auto", { value: 45, damage: "1D10" })],
        }),
      ],
      { notify: false },
    );
    const w = created[0].items.find((i: any) => i.type === "weapon");
    assert.equal(w.img, "en.svg");
  });

  test("a scalpel is a knife", async () => {
    mockCompendium({
      weapons: [
        weaponDoc("Knife, Small (switchblade, etc.)"),
        weaponDoc("Knife, Medium (carving knife, etc.)"),
      ],
    });
    await importCharacters(
      [
        makeCharacter({
          combat: [attack("Scalpel", { value: 70, damage: "1D4" })],
        }),
      ],
      { notify: false },
    );
    const w = created[0].items.find((i: any) => i.type === "weapon");
    assert.equal(w.name, "Scalpel");
    assert.equal(
      w.flags.CoC7.cocidFlag.id,
      weaponDoc("Knife, Small (switchblade, etc.)").flags.CoC7.cocidFlag.id,
    );
  });

  test("a beam staff is a Rifle/Shotgun firearm, not a club", async () => {
    mockCompendium({
      weapons: [weaponDoc("Club, large (baseball, cricket bat, poker)")],
    });
    await importCharacters(
      [
        makeCharacter({
          combat: [
            attack("Beam staff", { value: 45, damage: "1D10+5" }),
            attack("Blaster", { value: 50, damage: "1D8" }),
          ],
        }),
      ],
      { notify: false },
    );
    const staff = created[0].items.find(
      (i: any) => i.type === "weapon" && i.name === "Beam staff",
    );
    assert.equal(staff.flags?.CoC7?.cocidFlag, undefined); // no club match
    assert.equal(staff.system.properties.rngd, true);
    assert.equal(staff.system.skill.main.name, "Firearms (Rifle/Shotgun)");
    const laser = created[0].items.find(
      (i: any) => i.type === "weapon" && i.name === "Blaster",
    );
    assert.equal(laser.system.skill.main.name, "Firearms (Blaster)");
  });

  test("a weapon marked '(Throw)' uses the Throw skill", async () => {
    await importCharacters(
      [
        makeCharacter({
          skills: { Throw: 65 },
          combat: [attack("Jade Dart (Throw)", { value: 65, damage: "1D6" })],
        }),
      ],
      { notify: false },
    );
    const w = created[0].items.find((i: any) => i.type === "weapon");
    assert.equal(w.system.skill.main.name, "Throw");
  });

  test("a weapon named 'Throw …' uses the Throw skill", async () => {
    await importCharacters(
      [
        makeCharacter({
          skills: { Throw: 40 },
          combat: [attack("Throw rock", { value: 40, damage: "4D6" })],
        }),
      ],
      { notify: false },
    );
    const w = created[0].items.find((i: any) => i.type === "weapon");
    assert.equal(w.system.skill.main.name, "Throw");
  });

  test("knife/club size is deduced from damage, ignoring the damage bonus", async () => {
    mockCompendium({
      weapons: [
        weaponDoc("Knife, Small (switchblade, etc.)"),
        weaponDoc("Knife, Medium (carving knife, etc.)"),
        weaponDoc("Knife, Large (machete, etc.)"),
        weaponDoc("Club, small (nightstick)"),
        weaponDoc("Club, large (baseball, cricket bat, poker)"),
      ],
    });
    await importCharacters(
      [
        makeCharacter({
          combat: [
            attack("Switchblade", { value: 40, damage: "1D4+1D6" }), // small (DB die ignored)
            attack("Kitchen knife", { value: 40, damage: "1D4+2+DB" }), // medium
            attack("Hunting knife", { value: 40, damage: "1D8+1D4" }), // large
            attack("Nightstick", { value: 40, damage: "1D6+1D4" }), // small club
            attack("Heavy club", { value: 40, damage: "1D8+1" }), // large club
          ],
        }),
      ],
      { notify: false },
    );
    const cocid = (n: string) =>
      created[0].items.find((i: any) => i.type === "weapon" && i.name === n)
        .flags.CoC7.cocidFlag.id;
    assert.match(cocid("Switchblade"), /knife-small/);
    assert.match(cocid("Kitchen knife"), /knife-medium/);
    assert.match(cocid("Hunting knife"), /knife-large/);
    assert.match(cocid("Nightstick"), /club-small/);
    assert.match(cocid("Heavy club"), /club-large/);
  });

  test("blunt weapons and swords alias to Club/Sword by damage", async () => {
    mockCompendium({
      weapons: [
        weaponDoc("Club, large (baseball, cricket bat, poker)"),
        weaponDoc("Club, small (nightstick)"),
        weaponDoc("Sword, medium (rapier, heavy epee)"),
        weaponDoc("Sword, heavy (cavalry saber)"),
      ],
    });
    await importCharacters(
      [
        makeCharacter({
          combat: [
            attack("Crowbar", { value: 40, damage: "1D8" }),
            attack("Walking stick", { value: 40, damage: "1D6" }),
            attack("Broadsword", { value: 40, damage: "1D8" }), // no "1D8+1" -> medium
            attack("Sword of Akmallah", { value: 40, damage: "1D8+1" }), // -> heavy
          ],
        }),
      ],
      { notify: false },
    );
    const cocid = (n: string) =>
      created[0].items.find((i: any) => i.type === "weapon" && i.name === n)
        .flags.CoC7.cocidFlag.id;
    assert.match(cocid("Crowbar"), /club-large/);
    assert.match(cocid("Walking stick"), /club-small/);
    assert.match(cocid("Broadsword"), /sword-medium/);
    assert.match(cocid("Sword of Akmallah"), /sword-heavy/);
  });

  test("flavor-named firearms alias to their standard weapon", async () => {
    mockCompendium({
      weapons: [
        weaponDoc("Elephant Gun (2B)"),
        weaponDoc(".38 or 9mm Revolver"),
        weaponDoc(".32 or 7.65mm Automatic"),
      ],
    });
    await importCharacters(
      [
        makeCharacter({
          combat: [
            attack("Elephant gun", { value: 40, damage: "3D6+4" }),
            attack("Webley revolver", { value: 40, damage: "1D10" }),
            attack("Nambu pistol", { value: 40, damage: "1D8" }),
          ],
        }),
      ],
      { notify: false },
    );
    const cocid = (n: string) =>
      created[0].items.find((i: any) => i.type === "weapon" && i.name === n)
        .flags.CoC7.cocidFlag.id;
    assert.match(cocid("Elephant gun"), /elephant-gun/);
    assert.match(cocid("Webley revolver"), /9mm-revolver/);
    assert.match(cocid("Nambu pistol"), /7-65mm-automatic/);
  });

  test("an inlined damage bonus is normalized to the addb flag", async () => {
    await importCharacters(
      [
        makeCharacter({
          derived: {
            DB: "+1D6",
            Build: null,
            Move: null,
            MP: null,
            Luck: null,
          },
          combat: [
            attack("Tentacle", { value: 40, damage: "1D6+1D6" }), // trailing DB -> stripped
            attack("Fist", { value: 40, damage: "1D3+DB" }), // literal +DB -> stripped
            attack("Bite", { value: 40, damage: "1D8" }), // no bonus -> unchanged
            attack("Claw", { value: 40, damage: "1D6+1D4" }), // +1D4 != actor DB -> kept
          ],
        }),
      ],
      { notify: false },
    );
    const w = (n: string) =>
      created[0].items.find((i: any) => i.type === "weapon" && i.name === n);
    assert.equal(w("Tentacle").system.range.normal.damage, "1D6");
    assert.equal(w("Tentacle").system.properties.addb, true);
    assert.equal(w("Fist").system.range.normal.damage, "1D3");
    assert.equal(w("Fist").system.properties.addb, true);
    assert.equal(w("Bite").system.range.normal.damage, "1D8");
    assert.equal(w("Bite").system.properties.addb, false);
    assert.equal(w("Claw").system.range.normal.damage, "1D6+1D4"); // kept as-is
    assert.equal(w("Claw").system.properties.addb, false);
  });

  test("a thrown weapon's half damage bonus is normalized to the ahdb flag", async () => {
    await importCharacters(
      [
        makeCharacter({
          derived: {
            DB: "+1D6",
            Build: null,
            Move: null,
            MP: null,
            Luck: null,
          },
          combat: [
            attack("War boomerang", { value: 40, damage: "1D8+1D3" }), // half of +1D6
            attack("Rock", { value: 40, damage: "1D4+1D6" }), // full DB
          ],
        }),
      ],
      { notify: false },
    );
    const w = (n: string) =>
      created[0].items.find((i: any) => i.type === "weapon" && i.name === n);
    assert.equal(w("War boomerang").system.range.normal.damage, "1D8");
    assert.equal(w("War boomerang").system.properties.ahdb, true);
    assert.equal(w("War boomerang").system.properties.addb, false);
    assert.equal(w("Rock").system.properties.addb, true);
    assert.equal(w("Rock").system.properties.ahdb, false);
  });

  test("a thrown weapon is ranged and ranges to STR/5", async () => {
    await importCharacters(
      [
        makeCharacter({
          combat: [attack("Dart (thrown)", { value: 35, damage: "1D4" })],
        }),
      ],
      { notify: false },
    );
    const w = created[0].items.find(
      (i: any) => i.type === "weapon" && i.name === "Dart (thrown)",
    );
    assert.equal(w.system.properties.rngd, true);
    assert.equal(w.system.range.normal.value, "@STR/5");
    // The system's own `thrown` property stays false (it only swaps the roll to
    // the alternative skill; a thrown weapon's main skill already is Throw).
    assert.notEqual(w.system.properties.thrown, true);
  });

  test("a thrown weapon uses the actor's Throw skill when the value matches", async () => {
    await importCharacters(
      [
        makeCharacter({
          skills: { Throw: 40 },
          combat: [attack("Hatchet (thrown)", { value: 40, damage: "1D6+1" })],
        }),
      ],
      { notify: false },
    );
    const a = created[0];
    const thr = a.items.find(
      (i: any) => i.type === "skill" && i.name === "Throw",
    );
    const weapon = a.items.find(
      (i: any) => i.type === "weapon" && i.name === "Hatchet (thrown)",
    );
    assert.equal(weapon.system.skill.main.id, thr.id);
    // No redundant per-weapon skill created.
    assert.ok(
      !a.items.some((i: any) => /Hatchet/.test(i.name) && i.type === "skill"),
    );
  });

  test("a thrown weapon creates a Throw skill when the actor lacks one", async () => {
    await importCharacters(
      [
        makeCharacter({
          combat: [attack("Dart (thrown)", { value: 35, damage: "1D4" })],
        }),
      ],
      { notify: false },
    );
    const a = created[0];
    const thr = a.items.find(
      (i: any) => i.type === "skill" && i.name === "Throw",
    );
    assert.ok(thr, "Throw skill created");
    assert.equal(thr.system.base, "35");
    const weapon = a.items.find(
      (i: any) => i.type === "weapon" && i.name === "Dart (thrown)",
    );
    assert.equal(weapon.system.skill.main.id, thr.id);
  });

  test("a thrown weapon whose value differs from Throw gets its own skill", async () => {
    await importCharacters(
      [
        makeCharacter({
          skills: { Throw: 40 },
          combat: [attack("War boomerang", { value: 25, damage: "1D8" })], // 25 != Throw 40
        }),
      ],
      { notify: false },
    );
    const a = created[0];
    const thr = a.items.find(
      (i: any) => i.type === "skill" && i.name === "Throw",
    );
    const variant = a.items.find(
      (i: any) => i.type === "skill" && i.name === "Fighting (War boomerang)",
    );
    assert.ok(variant, "per-weapon skill created for the value mismatch");
    assert.equal(variant.system.base, "25");
    const weapon = a.items.find(
      (i: any) => i.type === "weapon" && i.name === "War boomerang",
    );
    assert.equal(weapon.system.skill.main.id, variant.id);
    assert.notEqual(weapon.system.skill.main.id, thr.id);
  });

  test("a melee weapon never matches a firearm entry (class-gated)", async () => {
    mockCompendium({ weapons: [weaponDoc(".38 or 9mm Revolver")] });
    await importCharacters(
      [
        makeCharacter({
          combat: [attack("Short sword", { value: 40, damage: "1D8" })],
        }),
      ],
      { notify: false },
    );
    // No compendium match -> a custom weapon named "Short sword".
    assert.ok(
      created[0].items.some(
        (i: any) => i.type === "weapon" && i.name === "Short sword",
      ),
    );
    assert.ok(
      !created[0].items.some((i: any) => i.name === ".38 or 9mm Revolver"),
    );
  });

  test("spells become spell items in order", async () => {
    await importCharacters(
      [makeCharacter({ spells: ["Cloud Memory", "Wither Limb"] })],
      { notify: false },
    );
    const spells = created[0].items.filter((i: any) => i.type === "spell");
    assert.deepEqual(
      spells.map((s: any) => s.name),
      ["Cloud Memory", "Wither Limb"],
    );
  });

  test("carried gear becomes generic item documents (quantity 1)", async () => {
    await importCharacters(
      [
        makeCharacter({
          items: ["notebook", "ghost hunting kit (string, matches)"],
        }),
      ],
      { notify: false },
    );
    const gear = created[0].items.filter((i: any) => i.type === "item");
    assert.deepEqual(
      gear.map((g: any) => g.name),
      ["notebook", "ghost hunting kit (string, matches)"],
    );
  });
});

// --- compendium lookup -----------------------------------------------------

// Install a CoC7 skill/weapon/spell compendium on the mocked game global.
// `otherEraWeapons` are flagged only for eras other than the world's: the best
// (era-filtered) query leaves them out and the all-eras query includes them.
function mockCompendium(opts: {
  skills?: any[];
  weapons?: any[];
  spells?: any[];
  creatures?: any[];
  otherEraWeapons?: any[];
}) {
  const byCoCID = (docs: any[]) =>
    Object.fromEntries(docs.map((d) => [d.flags.CoC7.cocidFlag.id, d]));
  const pick = (cocidRegExp: RegExp, weapons: any[]) =>
    cocidRegExp.source.includes("weapon")
      ? weapons
      : cocidRegExp.source.includes("spell")
        ? (opts.spells ?? [])
        : cocidRegExp.source.includes("creature")
          ? (opts.creatures ?? [])
          : [];
  (globalThis as any).game.CoC7 = {
    skillNames: { getList: async () => byCoCID(opts.skills ?? []) },
    cocid: {
      fromCoCIDRegexBest: async ({ cocidRegExp }: { cocidRegExp: RegExp }) =>
        pick(cocidRegExp, opts.weapons ?? []),
      fromCoCIDRegexAll: async ({
        cocidRegExp,
        era,
      }: {
        cocidRegExp: RegExp;
        era?: boolean;
      }) =>
        pick(cocidRegExp, [
          ...(opts.weapons ?? []),
          ...(era === false ? (opts.otherEraWeapons ?? []) : []),
        ]),
    },
  };
}

describe("importCharacters — compendium lookup", () => {
  test("a matched skill is cloned (icon + CoCID kept, base overridden)", async () => {
    mockCompendium({
      skills: [
        {
          name: "Spot Hidden",
          type: "skill",
          img: "icons/spot.webp",
          _id: "abc",
          system: { skillName: "Spot Hidden", specialization: "", base: "25" },
          flags: { CoC7: { cocidFlag: { id: "i.skill.spot-hidden" } } },
        },
      ],
    });
    await importCharacters([makeCharacter({ skills: { "Spot Hidden": 65 } })], {
      notify: false,
    });
    const s = item(created[0], "Spot Hidden");
    assert.equal(s.img, "icons/spot.webp");
    assert.equal(s.system.base, "65"); // parsed value applied
    assert.notEqual(s._id, "abc"); // compendium _id stripped; a fresh id assigned
    assert.equal(s.flags.CoC7.cocidFlag.id, "i.skill.spot-hidden");
  });

  test("a specialized skill falls back to the (Any) compendium template", async () => {
    mockCompendium({
      skills: [
        {
          name: "Science (Any)",
          type: "skill",
          img: "icons/science.webp",
          system: {
            skillName: "Any",
            specialization: "Science",
            base: "1",
            properties: {
              special: true,
              requiresname: true,
              picknameonly: true,
            },
          },
          flags: { CoC7: { cocidFlag: { id: "i.skill.science-any" } } },
        },
      ],
    });
    await importCharacters(
      [makeCharacter({ skills: { "Science (Biology)": 50 } })],
      { notify: false },
    );
    const s = item(created[0], "Science (Biology)");
    assert.equal(s.img, "icons/science.webp"); // template's icon
    assert.equal(s.system.skillName, "Biology");
    assert.equal(s.system.specialization, "Science");
    assert.equal(s.system.base, "50");
    assert.equal(s.system.properties.requiresname, false); // no re-prompt
    assert.equal(s.flags.CoC7.cocidFlag.id, "i.skill.science-biology");
  });

  test("an unspecialized '(Any)' skill imports as '(None)' so the sheet doesn't prompt", async () => {
    mockCompendium({
      skills: [
        {
          name: "Science (Any)",
          type: "skill",
          system: {
            skillName: "Any",
            specialization: "Science",
            base: "1",
            properties: {
              special: true,
              requiresname: true,
              picknameonly: true,
            },
          },
          flags: { CoC7: { cocidFlag: { id: "i.skill.science-any" } } },
        },
        {
          name: "Language (Other)",
          type: "skill",
          system: {
            skillName: "Any",
            specialization: "Language",
            base: "1",
            properties: {
              special: true,
              requiresname: true,
              picknameonly: true,
            },
          },
          flags: { CoC7: { cocidFlag: { id: "i.skill.language-other" } } },
        },
      ],
    });
    await importCharacters(
      [
        makeCharacter({
          skills: { "Science (any)": 40, "Language (Any)": 30 },
        }),
      ],
      { notify: false },
    );
    // "(Any)" -> "(None)", with skillName "None" and the prompt flags off, so the
    // sheet treats it as a concrete skill (skillName === "Any" would re-prompt).
    const sci = item(created[0], "Science (None)");
    assert.ok(sci, "Science (any) renamed to (None)");
    assert.equal(sci.system.skillName, "None");
    assert.equal(sci.system.properties.requiresname, false);
    assert.equal(sci.system.properties.picknameonly, false);
    assert.equal(sci.system.base, "40");
    const lang = item(created[0], "Language (None)");
    assert.ok(lang, "Language (Any) renamed to (None)");
    assert.equal(lang.system.skillName, "None");
    assert.equal(lang.system.base, "30");
  });

  test("a matched weapon keeps compendium metadata but takes the book's damage", async () => {
    mockCompendium({
      skills: [
        {
          name: "Fighting (Brawl)",
          type: "skill",
          system: {
            skillName: "Brawl",
            specialization: "Fighting",
            base: "25",
          },
          flags: { CoC7: { cocidFlag: { id: "i.skill.fighting-brawl" } } },
        },
      ],
      weapons: [
        {
          name: "Brass Knuckles",
          type: "weapon",
          img: "icons/knuckles.webp",
          system: {
            skill: { main: { name: "i.skill.fighting-brawl" } },
            range: { normal: { damage: "1D3+1" } },
            properties: { rngd: false, addb: true },
          },
          flags: { CoC7: { cocidFlag: { id: "i.weapon.brass-knuckles" } } },
        },
      ],
    });
    await importCharacters(
      [
        makeCharacter({
          combat: [attack("Brass Knuckles", { value: 55, damage: "1D3" })],
        }),
      ],
      { notify: false },
    );
    const a = created[0];
    const weapon = a.items.find(
      (i: any) => i.type === "weapon" && i.name === "Brass Knuckles",
    );
    // Metadata from the compendium...
    assert.equal(weapon.img, "icons/knuckles.webp");
    assert.equal(weapon.flags.CoC7.cocidFlag.id, "i.weapon.brass-knuckles");
    // ...but the book's damage (1D3) overrides the compendium's (1D3+1), and the
    // add-DB flag reflects our parse (no bonus in the book damage).
    assert.equal(weapon.system.range.normal.damage, "1D3");
    assert.equal(weapon.system.properties.addb, false);
    const skill = a.items.find(
      (i: any) => i.type === "skill" && i.name === "Fighting (Brawl)",
    );
    assert.equal(skill.system.base, "55"); // attack skill % applied to backing skill
    assert.equal(skill.flags.CoC7.cocidFlag.id, "i.skill.fighting-brawl");
  });

  const brawlSkill = () => ({
    name: "Fighting (Brawl)",
    type: "skill",
    system: { skillName: "Brawl", specialization: "Fighting", base: "25" },
    flags: { CoC7: { cocidFlag: { id: "i.skill.fighting-brawl" } } },
  });
  const unarmed = () => ({
    name: "Unarmed",
    type: "weapon",
    img: "icons/unarmed.svg",
    system: {
      skill: { main: { name: "i.skill.fighting-brawl" } },
      range: { normal: { damage: "1D3" } },
      properties: { rngd: false, addb: true },
    },
    flags: { CoC7: { cocidFlag: { id: "i.weapon.brawl" } } },
  });
  const mnvr = () => ({
    name: "Mnvr",
    type: "weapon",
    img: "icons/mnvr.svg",
    system: {
      skill: { main: { name: "i.skill.fighting-brawl" } },
      range: { normal: { damage: "" } },
      properties: { rngd: false, mnvr: true, addb: false },
    },
    flags: { CoC7: { cocidFlag: { id: "i.weapon.mnvr" } } },
  });
  const weaponsOf = (a: any) => a.items.filter((i: any) => i.type === "weapon");

  test("a printed Brawl is the system's Unarmed under the book's name, with a Mnvr", async () => {
    mockCompendium({ skills: [brawlSkill()], weapons: [unarmed(), mnvr()] });
    await importCharacters(
      [
        makeCharacter({
          combat: [attack("Brawl", { value: 45, damage: "1D3" })],
        }),
        makeCharacter({
          name: "Thug",
          combat: [attack("Fighting (Brawl)", { value: 55, damage: "1D3" })],
        }),
      ],
      { notify: false },
    );
    for (const [a, value] of [
      [created[0], "45"],
      [created[1], "55"],
    ]) {
      const [brawl, maneuver] = weaponsOf(a);
      assert.equal(brawl.name, "Brawl");
      assert.equal(brawl.flags.CoC7.cocidFlag.id, "i.weapon.brawl");
      assert.equal(brawl.system.range.normal.damage, "1D3");
      assert.equal(maneuver.name, "Mnvr");
      assert.equal(maneuver.flags.CoC7.cocidFlag.id, "i.weapon.mnvr");
      assert.equal(maneuver.system.skill.main.name, "i.skill.fighting-brawl");
      assert.equal(maneuver.system.properties.mnvr, true);
      const skills = a.items.filter(
        (i: any) => i.type === "skill" && i.name === "Fighting (Brawl)",
      );
      assert.equal(skills.length, 1);
      assert.equal(skills[0].system.base, value);
    }
  });

  test("Mnvr comes only with a Brawl, and not beside a human's printed manoeuvre", async () => {
    mockCompendium({ skills: [brawlSkill()], weapons: [unarmed(), mnvr()] });
    await importCharacters(
      [
        // An animal with no Sanity loss line: an NPC without a Brawl.
        makeCharacter({ combat: [attack("Fighting", { value: 50 })] }),
        makeCharacter({
          sanityLoss: "1/1D6",
          combat: [attack("Fighting", { value: 50 })],
        }),
        makeCharacter({
          combat: [
            attack("Brawl", { value: 45, damage: "1D3" }),
            attack("Grab (mnvr)", { value: 45, damage: null }),
          ],
        }),
        // A creature's printed manoeuvre uses its Fighting skill, not Brawl.
        makeCharacter({
          sanityLoss: "1/1D6",
          combat: [
            attack("Brawl", { value: 45, damage: "1D3" }),
            attack("Grab (mnvr)", { value: 60, damage: null }),
          ],
        }),
      ],
      { notify: false },
    );
    const names = created.map((a) => weaponsOf(a).map((w: any) => w.name));
    assert.deepEqual(names, [
      ["Fighting"],
      ["Fighting"],
      ["Brawl", "Grab (mnvr)"],
      ["Brawl", "Mnvr", "Grab (mnvr)"],
    ]);
  });

  test("without the system's Mnvr, a Brawl still links to Unarmed", async () => {
    mockCompendium({ skills: [brawlSkill()], weapons: [unarmed()] });
    await importCharacters(
      [
        makeCharacter({
          combat: [attack("Brawl", { value: 45, damage: "1D3" })],
        }),
      ],
      { notify: false },
    );
    const weapons = weaponsOf(created[0]);
    assert.equal(weapons.length, 1);
    assert.equal(weapons[0].flags.CoC7.cocidFlag.id, "i.weapon.brawl");
  });

  const lightningGun = () => ({
    name: "Lightning Gun",
    type: "weapon",
    system: {
      skill: { main: { name: "Firearms (Lightning Gun)" } },
      range: { normal: { damage: "1D10" } },
      properties: { rngd: true, impl: true },
    },
    flags: { CoC7: { cocidFlag: { id: "i.weapon.lightning-gun" } } },
  });

  test("a matched weapon takes the book's damage even with trailing prose", async () => {
    mockCompendium({ weapons: [lightningGun()] });
    await importCharacters(
      [
        makeCharacter({
          combat: [
            attack("Lightning Gun", { value: 40, damage: "2D8 per charge" }),
          ],
        }),
      ],
      { notify: false },
    );
    const weapon = created[0].items.find(
      (i: any) => i.type === "weapon" && i.name === "Lightning Gun",
    );
    assert.equal(weapon.system.range.normal.damage, "2D8"); // book 2D8, not compendium 1D10
    assert.equal(weapon.system.properties.impl, true); // metadata preserved
  });

  test("a matched weapon with non-formula damage keeps the compendium's", async () => {
    mockCompendium({ weapons: [lightningGun()] });
    await importCharacters(
      [
        makeCharacter({
          combat: [
            attack("Lightning Gun", {
              value: 40,
              damage: "special (see text)",
            }),
          ],
        }),
      ],
      { notify: false },
    );
    const weapon = created[0].items.find(
      (i: any) => i.type === "weapon" && i.name === "Lightning Gun",
    );
    assert.equal(weapon.system.range.normal.damage, "1D10"); // no dice term -> kept
  });

  test("a compendium weapon whose skill doesn't exist creates that exact named skill", async () => {
    // The weapon references "Firearms (Lightning Gun)" by name, but only the
    // generic "Firearms (Any)" template exists. We must create the exact skill,
    // not fold it into "(Any)" (which would prompt for a specialization).
    mockCompendium({
      skills: [
        {
          name: "Firearms (Any)",
          type: "skill",
          img: "firearms.svg",
          system: {
            skillName: "Any",
            specialization: "Firearms",
            base: "1",
            properties: { special: true, requiresname: true },
          },
          flags: { CoC7: { cocidFlag: { id: "i.skill.firearms-any" } } },
        },
      ],
      weapons: [
        {
          name: "Lightning Gun",
          type: "weapon",
          img: "lg.svg",
          system: {
            skill: { main: { name: "Firearms (Lightning Gun)" } },
            range: { normal: { damage: "1D10" } },
            properties: { rngd: true },
          },
          flags: { CoC7: { cocidFlag: { id: "i.weapon.lightning-gun" } } },
        },
      ],
    });
    await importCharacters(
      [
        makeCharacter({
          combat: [attack("Lightning Gun", { value: 40, damage: "1D10" })],
        }),
      ],
      { notify: false },
    );
    const a = created[0];
    assert.ok(
      a.items.find(
        (i: any) => i.type === "weapon" && i.name === "Lightning Gun",
      ),
    );
    const skill = a.items.find(
      (i: any) => i.type === "skill" && i.name === "Firearms (Lightning Gun)",
    );
    assert.ok(skill, "exact named skill created");
    assert.equal(skill.system.skillName, "Lightning Gun"); // not "Any"
    assert.equal(skill.system.base, "40");
    // No generic "(Any)" skill was added (which would pop the dialog).
    assert.ok(
      !a.items.some(
        (i: any) => i.type === "skill" && i.name === "Firearms (Any)",
      ),
    );
  });

  test("a matched spell is cloned and CoCID-stamped", async () => {
    mockCompendium({
      spells: [
        {
          name: "Wither Limb",
          type: "spell",
          img: "icons/wither.webp",
          system: {},
          flags: { CoC7: { cocidFlag: { id: "i.spell.wither-limb" } } },
        },
      ],
    });
    await importCharacters([makeCharacter({ spells: ["Wither Limb"] })], {
      notify: false,
    });
    const sp = item(created[0], "Wither Limb");
    assert.equal(sp.img, "icons/wither.webp");
    assert.equal(sp.flags.CoC7.cocidFlag.id, "i.spell.wither-limb");
  });

  test("a spell printed loosely takes the system spell's name and CoCID", async () => {
    mockCompendium({
      spells: [
        {
          name: "Contact Deity: Mistgod",
          type: "spell",
          system: {},
          flags: {
            CoC7: { cocidFlag: { id: "i.spell.contact-deity-mistgod" } },
          },
        },
      ],
    });
    await importCharacters([makeCharacter({ spells: ["Contact Mistgod"] })], {
      notify: false,
    });
    const sp = item(created[0], "Contact Deity: Mistgod");
    assert.equal(sp.flags.CoC7.cocidFlag.id, "i.spell.contact-deity-mistgod");
  });

  test("the book's own spell comes before the system's", async () => {
    mockCompendium({
      spells: [
        {
          name: "Contact Deity: Mistgod",
          type: "spell",
          system: {},
          flags: {
            CoC7: { cocidFlag: { id: "i.spell.contact-deity-mistgod" } },
          },
        },
      ],
    });
    await importCharacters([makeCharacter({ spells: ["Contact Mistgod"] })], {
      notify: false,
      bookSpells: [
        {
          name: "Contact Mistgod (Variant)",
          type: "spell",
          system: { castingTime: "1 round" },
        },
      ],
    });
    const sp = item(created[0], "Contact Mistgod (Variant)");
    assert.equal(sp.system.castingTime, "1 round");
    assert.equal(sp.flags.CoC7.cocidFlag.id, "i.spell.contact-mistgod-variant");
  });

  test("skills and spells are CoCID-stamped even without a compendium", async () => {
    await importCharacters(
      [
        makeCharacter({
          skills: { "Spot Hidden": 40 },
          spells: ["Cloud Memory"],
        }),
      ],
      { notify: false },
    );
    assert.equal(
      item(created[0], "Spot Hidden").flags.CoC7.cocidFlag.id,
      "i.skill.spot-hidden",
    );
    assert.equal(
      item(created[0], "Cloud Memory").flags.CoC7.cocidFlag.id,
      "i.spell.cloud-memory",
    );
  });

  // Language templates used in the tests below.
  const LANG_ITEMS = {
    own: {
      name: "Language (Own)",
      type: "skill",
      img: "own.svg",
      system: {
        skillName: "Own",
        specialization: "Language",
        base: "@EDU",
        properties: { special: true, requiresname: true, keepbasevalue: true },
      },
      flags: { CoC7: { cocidFlag: { id: "i.skill.language-own" } } },
    },
    any: {
      name: "Language (Any)",
      type: "skill",
      img: "any.svg",
      system: {
        skillName: "Any",
        specialization: "Language",
        base: "1",
        properties: { special: true, requiresname: true },
      },
      flags: { CoC7: { cocidFlag: { id: "i.skill.language-any" } } },
    },
    english: {
      name: "Language (English)",
      type: "skill",
      img: "english.svg",
      system: {
        skillName: "English",
        specialization: "Language",
        base: "1",
        properties: { special: true },
      },
      flags: { CoC7: { cocidFlag: { id: "i.skill.language-english" } } },
    },
  };

  test("the own template is used even when an exact language item exists", async () => {
    mockCompendium({
      skills: [LANG_ITEMS.english, LANG_ITEMS.own, LANG_ITEMS.any],
    });
    await importCharacters(
      [
        makeCharacter({
          characteristics: chars({ EDU: 80 }),
          skills: { "Language (English)": 80, "Language (French)": 30 },
        }),
      ],
      { notify: false },
    );
    const a = created[0];
    // English equals EDU -> the OWN template, not the exact "Language (English)".
    const eng = item(a, "Language (English)");
    assert.equal(eng.img, "own.svg"); // Language (Own), not english.svg
    assert.equal(eng.system.skillName, "English");
    assert.equal(eng.system.base, "@EDU"); // own language tracks EDU
    // French does not equal EDU -> Language (Other) missing -> Language (Any).
    const fr = item(a, "Language (French)");
    assert.equal(fr.img, "any.svg");
    assert.equal(fr.system.skillName, "French");
    assert.equal(fr.system.specialization, "Language");
    assert.equal(fr.system.base, "30");
    assert.equal(fr.system.properties.requiresname, false);
    assert.equal(fr.flags.CoC7.cocidFlag.id, "i.skill.language-french");
  });

  test("a language equal to EDU clones Language (Own); others clone Language (Any)", async () => {
    mockCompendium({ skills: [LANG_ITEMS.own, LANG_ITEMS.any] });
    await importCharacters(
      [
        makeCharacter({
          characteristics: chars({ EDU: 75 }),
          skills: { "Language (Tsalal)": 75, "Language (French)": 30 },
        }),
      ],
      { notify: false },
    );
    const a = created[0];
    const own = item(a, "Language (Tsalal)"); // equals EDU -> own
    assert.equal(own.img, "own.svg"); // cloned from Language (Own)
    assert.equal(own.system.skillName, "Tsalal");
    assert.equal(own.system.base, "@EDU"); // own language tracks EDU
    assert.equal(own.flags.CoC7.cocidFlag.id, "i.skill.language-tsalal");
    const fr = item(a, "Language (French)"); // not EDU -> Language (Any)
    assert.equal(fr.img, "any.svg");
    assert.equal(fr.system.base, "30"); // concrete value kept
  });

  test("a language above EDU keeps its concrete value (not pinned to EDU)", async () => {
    mockCompendium({ skills: [LANG_ITEMS.own, LANG_ITEMS.any] });
    await importCharacters(
      [
        makeCharacter({
          // An English professor: English is above EDU, so it is not "own".
          characteristics: chars({ EDU: 70 }),
          skills: { "Language (English)": 90 },
        }),
      ],
      { notify: false },
    );
    const eng = item(created[0], "Language (English)");
    assert.equal(eng.img, "any.svg"); // not the own template
    assert.equal(eng.system.base, "90"); // concrete value, not @EDU
  });

  test("languages get the system icon even without a compendium", async () => {
    await importCharacters(
      [makeCharacter({ skills: { "Language (Latin)": 40 } })],
      { notify: false },
    );
    const lat = item(created[0], "Language (Latin)");
    assert.equal(lat.type, "skill");
    assert.equal(lat.img, "systems/CoC7/assets/icons/skills/language.svg");
    assert.equal(lat.system.skillName, "Latin");
    assert.equal(lat.flags.CoC7.cocidFlag.id, "i.skill.language-latin");
  });

  test("a skill shared between the skills list and combat is added once", async () => {
    await importCharacters(
      [
        makeCharacter({
          skills: { Dodge: 30 },
          combat: [attack("Dodge", { value: 50, damage: null })],
        }),
      ],
      { notify: false },
    );
    const dodges = created[0].items.filter((i: any) => i.name === "Dodge");
    assert.equal(dodges.length, 1);
    assert.equal(dodges[0].system.base, "30"); // first (skills) wins
  });
});

describe("importCharacters — folders and de-duplication", () => {
  test("reuses an existing Actor folder of the same name", async () => {
    folders.push({ id: "existing", name: "My Import", type: "Actor" });
    await importCharacters([makeCharacter()], {
      folderName: "My Import",
      notify: false,
    });
    assert.equal(created[0].folder, "existing");
    assert.equal(folders.length, 1); // none created
  });

  test("does not reuse a same-named Actor folder nested inside another", async () => {
    folders.push({
      id: "nested",
      name: "My Import",
      type: "Actor",
      folder: { id: "other" },
    });
    await importCharacters([makeCharacter()], {
      folderName: "My Import",
      notify: false,
    });
    assert.equal(folders.length, 2);
    assert.notEqual(created[0].folder, "nested");
    assert.equal(folders[1].folder, undefined); // created at the top level
  });

  test("creates the named folder when none exists", async () => {
    await importCharacters([makeCharacter()], {
      folderName: "New Folder",
      notify: false,
    });
    assert.equal(folders.length, 1);
    assert.equal(folders[0].name, "New Folder");
    assert.equal(folders[0].type, "Actor");
  });

  // An actor already in the folder, as Foundry would hold it.
  const existingActor = (id: string, name: string, extra: object = {}) => {
    const old: any = {
      id,
      name,
      folder: { id: "fi" },
      deleted: false,
      ...extra,
    };
    old.toObject = () => ({
      _id: id,
      name,
      type: "npc",
      folder: "fi",
      system: { old: true },
      ...extra,
    });
    old.delete = async () => {
      old.deleted = true;
      world.splice(world.indexOf(old), 1);
    };
    world.push(old);
    return old;
  };

  test("re-import replaces a same-named actor under its existing id", async () => {
    folders.push({ id: "fi", name: "Import", type: "Actor" });
    const old = existingActor("old", "Test Subject");
    await importCharacters([makeCharacter({ name: "Test Subject" })], {
      folderName: "Import",
      notify: false,
    });
    assert.equal(old.deleted, true);
    assert.equal(created.length, 1);
    assert.equal(created[0].id, "old"); // same id, so tokens and links resolve
    assert.equal(created[0].deleted, false);
    assert.equal(created[0].system.old, undefined); // book data, not the old data
  });

  test("a replaced actor keeps its Keeper-owned fields", async () => {
    folders.push({ id: "fi", name: "Import", type: "Actor" });
    existingActor("old", "Test Subject", {
      img: "custom/portrait.webp",
      prototypeToken: { texture: { src: "custom/token.webp" } },
      ownership: { default: 2 },
      sort: 500,
    });
    await importCharacters([makeCharacter({ name: "Test Subject" })], {
      folderName: "Import",
      notify: false,
    });
    assert.equal(created[0].img, "custom/portrait.webp");
    assert.deepEqual(created[0].prototypeToken, {
      texture: { src: "custom/token.webp" },
    });
    assert.deepEqual(created[0].ownership, { default: 2 });
    assert.equal(created[0].sort, 500);
  });

  // A system creature with art of its own.
  const coreCreature = (name: string, img: string, token: string) => ({
    name,
    type: "creature",
    img,
    prototypeToken: { texture: { src: token } },
    flags: { CoC7: { cocidFlag: { id: `a.creature.${name.toLowerCase()}` } } },
  });

  test("a creature the system has takes its portrait and token art", async () => {
    mockCompendium({
      creatures: [
        coreCreature("Mire Worm", "art/worm.webp", "tokens/worm.webp"),
      ],
    });
    await importCharacters(
      [
        makeCharacter({ name: "Mire Worms", sanityLoss: "1/1D6" }),
        makeCharacter({ name: "Mire Worm of the Deep", sanityLoss: "1/1D6" }),
        makeCharacter({ name: "Mire Worm" }),
      ],
      { notify: false },
    );
    const [plural, qualified, npc] = created;
    assert.equal(plural.img, "art/worm.webp");
    assert.deepEqual(plural.prototypeToken, {
      texture: { src: "tokens/worm.webp" },
    });
    assert.equal(qualified.img, "art/worm.webp");
    assert.equal(npc.img, undefined); // an NPC of that name is not the creature
  });

  test("a re-imported creature keeps its own art but not a default icon", async () => {
    mockCompendium({
      creatures: [
        coreCreature("Mire Worm", "art/worm.webp", "tokens/worm.webp"),
      ],
    });
    folders.push({ id: "fi", name: "Import", type: "Actor" });
    existingActor("a1", "Mire Worm", {
      type: "creature",
      img: "systems/CoC7/assets/icons/floating-tentacles.svg",
      prototypeToken: {
        actorLink: true,
        texture: { src: "systems/CoC7/assets/icons/floating-tentacles.svg" },
      },
    });
    existingActor("a2", "Mire Worm Queen", {
      type: "creature",
      img: "custom/queen.webp",
      prototypeToken: { texture: { src: "custom/queen-token.webp" } },
    });
    await importCharacters(
      [
        makeCharacter({ name: "Mire Worm", sanityLoss: "1/1D6" }),
        makeCharacter({ name: "Mire Worm Queen", sanityLoss: "1/1D6" }),
      ],
      { folderName: "Import", notify: false },
    );
    const worm = created.find((a) => a.id === "a1");
    assert.equal(worm.img, "art/worm.webp");
    assert.deepEqual(worm.prototypeToken, {
      actorLink: true,
      texture: { src: "tokens/worm.webp" },
    });
    const queen = created.find((a) => a.id === "a2");
    assert.equal(queen.img, "custom/queen.webp");
    assert.equal(queen.prototypeToken.texture.src, "custom/queen-token.webp");
  });

  test("a failed replace restores the old actor under its id", async () => {
    folders.push({ id: "fi", name: "Import", type: "Actor" });
    existingActor("old", "Test Subject");
    const ok = (globalThis as any).Actor.create;
    (globalThis as any).Actor.create = async (d: any, o: any) => {
      if (!d.system?.old) throw new Error("boom");
      return ok(d, o);
    };
    const realError = console.error;
    console.error = () => {};
    try {
      const res = await importCharacters(
        [makeCharacter({ name: "Test Subject" })],
        { folderName: "Import", notify: false },
      );
      assert.equal(res.failed, 1);
    } finally {
      console.error = realError;
    }
    assert.equal(created.length, 1);
    assert.equal(created[0].id, "old");
    assert.equal(created[0].system.old, true); // the snapshot, restored
  });

  test("same-named characters each replace their own old actor; extras go", async () => {
    folders.push({ id: "fi", name: "Import", type: "Actor" });
    existingActor("c1", "Cultist");
    existingActor("c2", "Cultist");
    const c3 = existingActor("c3", "Cultist");
    const bystander = existingActor("b1", "Bystander");
    await importCharacters(
      [makeCharacter({ name: "Cultist" }), makeCharacter({ name: "Cultist" })],
      { folderName: "Import", notify: false },
    );
    assert.deepEqual(
      created.map((a) => a.id),
      ["c1", "c2"],
    );
    assert.equal(c3.deleted, true); // more old than incoming: the extra is removed
    assert.equal(bystander.deleted, false); // not in this import: untouched
  });
});

describe("importCharacters — source citation", () => {
  test("an actor's Keeper notes open with the book and printed page", async () => {
    await importCharacters(
      [
        makeCharacter({
          name: "Alpha",
          page: 12,
          printedPage: 11,
          sanityLoss: "1/1D4",
        }),
        makeCharacter({ name: "Bravo", page: 30 }),
      ],
      { notify: false, source: "Test Book" },
    );
    const keeper = (n: string) =>
      created.find((a) => a.name === n).system.description.keeper;
    assert.match(
      keeper("Alpha"),
      /^<p>Source: Test Book, p\. 11<\/p><p>Sanity loss/,
    );
    assert.match(keeper("Bravo"), /^<p>Source: Test Book, PDF page 30<\/p>/);
  });

  test("without a source, no citation is written", async () => {
    await importCharacters([makeCharacter({ page: 12, printedPage: 11 })], {
      notify: false,
    });
    assert.doesNotMatch(created[0].system.description.keeper, /Source:/);
  });
});

describe("importCharacters — paragraphs", () => {
  test("an investigator's background sections keep their paragraphs", async () => {
    await importCharacters(
      [
        makeCharacter({
          age: 30,
          background: [
            { title: "Personal Description", text: "Tall.\n\nQuiet." },
            { title: "Significant People", text: "A friend." },
          ],
        }),
      ],
      { notify: false },
    );
    const bio = created[0].system.biography;
    assert.equal(bio[0].value, "<p>Tall.</p><p>Quiet.</p>");
    assert.equal(bio[1].value, "<p>A friend.</p>");
    assert.match(created[0].system.backstory, /<p>Tall\.<\/p><p>Quiet\.<\/p>/);
  });
});

describe("importCharacters — CoC IDs", () => {
  test("an actor's CoCID is namespaced to the importer and the book", async () => {
    await importCharacters(
      [
        makeCharacter({ name: "Test Lizard", sanityLoss: "0/1D6" }),
        makeCharacter({ name: "Dr. Test Person" }),
      ],
      { notify: false, source: "The Test Book" },
    );
    const cocid = (n: string) =>
      created.find((a) => a.name === n).flags.CoC7.cocidFlag.id;
    assert.equal(
      cocid("Test Lizard"),
      "a.creature.hh-the-test-book-test-lizard",
    );
    assert.equal(
      cocid("Dr. Test Person"),
      "a.npc.hh-the-test-book-dr-test-person",
    );
  });

  test("without a book, the namespace is the importer's alone", async () => {
    await importCharacters([makeCharacter({ name: "Alpha" })], {
      notify: false,
    });
    assert.equal(created[0].flags.CoC7.cocidFlag.id, "a.npc.hh-alpha");
  });
});

describe("importCharacters — chapter folders", () => {
  const folderNamed = (name: string) => folders.find((f) => f.name === name);
  const parentId = (f: any) => f?.folder?.id ?? f?.folder ?? null;

  test("characters are filed in chapter subfolders, in book order", async () => {
    await importCharacters(
      [
        makeCharacter({ name: "Alpha", chapter: "Chapter 1: Testland" }),
        makeCharacter({ name: "Bravo", chapter: "Chapter 2: Second" }),
        makeCharacter({ name: "Charlie", chapter: "Chapter 1: Testland" }),
        makeCharacter({ name: "Delta" }), // no chapter: stays at the top
      ],
      { folderName: "Book", notify: false },
    );
    const book = folderNamed("Book");
    const ch1 = folderNamed("Chapter 1: Testland");
    const ch2 = folderNamed("Chapter 2: Second");
    assert.equal(parentId(ch1), book.id);
    assert.equal(parentId(ch2), book.id);
    assert.ok(ch1.sort < ch2.sort); // printed order, not alphabetical
    assert.equal(book.sorting, "m");
    const folderOf = (n: string) => created.find((a) => a.name === n).folder;
    assert.equal(folderOf("Alpha"), ch1.id);
    assert.equal(folderOf("Charlie"), ch1.id);
    assert.equal(folderOf("Bravo"), ch2.id);
    assert.equal(folderOf("Delta"), book.id);
  });

  test("a re-import finds the old actor at the top level and moves it, keeping its id", async () => {
    folders.push({ id: "fi", name: "Book", type: "Actor" });
    const old: any = { id: "old", name: "Alpha", folder: { id: "fi" } };
    old.toObject = () => ({
      _id: "old",
      name: "Alpha",
      type: "npc",
      folder: "fi",
    });
    old.delete = async () => world.splice(world.indexOf(old), 1);
    world.push(old);
    await importCharacters(
      [makeCharacter({ name: "Alpha", chapter: "Chapter 1: Testland" })],
      { folderName: "Book", notify: false },
    );
    assert.equal(created.length, 1);
    assert.equal(created[0].id, "old");
    assert.equal(created[0].folder, folderNamed("Chapter 1: Testland").id);
  });

  test("a re-import finds the old actor inside its chapter folder", async () => {
    folders.push({ id: "fi", name: "Book", type: "Actor", sorting: "m" });
    folders.push({
      id: "ch",
      name: "Chapter 1: Testland",
      type: "Actor",
      folder: { id: "fi" },
    });
    const old: any = { id: "old", name: "Alpha", folder: { id: "ch" } };
    old.toObject = () => ({
      _id: "old",
      name: "Alpha",
      type: "npc",
      folder: "ch",
    });
    old.delete = async () => world.splice(world.indexOf(old), 1);
    world.push(old);
    await importCharacters(
      [makeCharacter({ name: "Alpha", chapter: "Chapter 1: Testland" })],
      { folderName: "Book", notify: false },
    );
    assert.equal(folders.length, 2); // chapter folder reused
    assert.equal(created[0].id, "old");
    assert.equal(created[0].folder, "ch");
  });
});

describe("importCharacters — group table folders", () => {
  const folderNamed = (name: string) => folders.find((f) => f.name === name);
  const parentId = (f: any) => f?.folder?.id ?? f?.folder ?? null;
  const member = (
    name: string,
    chapter: string,
    title: string,
    folder: string,
    label: string,
  ) => makeCharacter({ name, chapter, table: { title, label, folder } });

  test("a table's members go in its folder inside their chapter", async () => {
    await importCharacters(
      [
        member("Grue 1", "Chapter 1: Fog", "Grues, Fog Hunters", "Grues", "1"),
        member("Grue 2", "Chapter 1: Fog", "Grues, Fog Hunters", "Grues", "2"),
        makeCharacter({ name: "Ada Lark", chapter: "Chapter 1: Fog" }),
      ],
      { folderName: "Book", source: "Book", notify: false },
    );
    const chapter = folderNamed("Chapter 1: Fog");
    const table = folderNamed("Grues");
    assert.equal(parentId(table), chapter.id);
    assert.equal(table.description, "Grues, Fog Hunters");
    const byName = (n: string) => created.find((a) => a.name === n);
    assert.equal(byName("Grue 1").folder, table.id);
    assert.equal(byName("Grue 2").folder, table.id);
    assert.equal(byName("Ada Lark").folder, chapter.id);
    assert.equal(
      byName("Grue 1").flags["coc-pdf-importer"].table,
      "Grues, Fog Hunters",
    );
  });

  test("same-named members of two tables keep their own ids on a re-import", async () => {
    folders.push({ id: "fi", name: "Book", type: "Actor", sorting: "m" });
    const old = (id: string, table: string): any => {
      const doc: any = {
        id,
        name: "Fog Cultist 1",
        folder: { id: "fi" },
        flags: { "coc-pdf-importer": { table } },
      };
      doc.toObject = () => ({ _id: id, name: doc.name, type: "npc" });
      doc.delete = async () => world.splice(world.indexOf(doc), 1);
      return doc;
    };
    world.push(old("east", "East Cultists"), old("west", "West Cultists"));
    // Imported in the other order: pairing by name alone would swap them.
    await importCharacters(
      [
        member(
          "Fog Cultist 1",
          "Chapter 2: West",
          "West Cultists",
          "West",
          "1",
        ),
        member(
          "Fog Cultist 1",
          "Chapter 1: East",
          "East Cultists",
          "East",
          "1",
        ),
      ],
      { folderName: "Book", source: "Book", notify: false },
    );
    const inFolder = (name: string) =>
      created.find((a) => a.folder === folderNamed(name).id);
    assert.equal(inFolder("West").id, "west");
    assert.equal(inFolder("East").id, "east");
    assert.notEqual(
      inFolder("West").flags.CoC7.cocidFlag.id,
      inFolder("East").flags.CoC7.cocidFlag.id,
    );
  });
});

describe("importCharacters — book-titled folders", () => {
  test("a re-import renames the file-named folder to the title, keeping its actors' ids", async () => {
    folders.push({ id: "fi", name: "test_book_v1", type: "Actor" });
    folders[0].update = async (u: any) => Object.assign(folders[0], u);
    const old: any = { id: "old", name: "Alpha", folder: { id: "fi" } };
    old.toObject = () => ({
      _id: "old",
      name: "Alpha",
      type: "npc",
      folder: "fi",
    });
    old.delete = async () => world.splice(world.indexOf(old), 1);
    world.push(old);
    await importCharacters([makeCharacter({ name: "Alpha" })], {
      folderName: "Test Book",
      sourceFile: "test_book_v1",
      notify: false,
    });
    assert.equal(folders.length, 1);
    assert.equal(folders[0].name, "Test Book");
    assert.equal(created[0].id, "old");
    assert.equal(created[0].folder, "fi");
  });
});

describe("importCharacters — result and notifications", () => {
  test("returns created / failed counts and surfaces a summary notification", async () => {
    const res = await importCharacters([makeCharacter(), makeCharacter()]);
    assert.equal(res.created, 2);
    assert.equal(res.failed, 0);
    assert.equal(res.actors.length, 2);
    assert.equal(notes.length, 1); // default notify: true
  });

  test("notify: false suppresses the notification", async () => {
    await importCharacters([makeCharacter()], { notify: false });
    assert.equal(notes.length, 0);
  });

  test("a failed Actor.create counts as a failure without aborting the batch", async () => {
    const ok = (globalThis as any).Actor.create;
    (globalThis as any).Actor.create = async (d: any) => {
      if (d.name === "Bad") throw new Error("boom");
      return ok(d);
    };
    const errors: unknown[] = [];
    const realError = console.error;
    console.error = (...a: unknown[]) => errors.push(a);
    try {
      const res = await importCharacters(
        [makeCharacter({ name: "Good" }), makeCharacter({ name: "Bad" })],
        { notify: false },
      );
      assert.equal(res.created, 1);
      assert.equal(res.failed, 1);
      assert.equal(res.actors.length, 1);
    } finally {
      console.error = realError;
    }
    assert.equal(errors.length, 1);
  });
});

describe("importCharacters — pulp variants", () => {
  const pulpCharacter = () =>
    makeCharacter({
      name: "Pulp Hero",
      combat: [
        attack("Brawl", { value: 60, half: 30, fifth: 12 }),
        attack("Dodge", { value: 50, half: 25, fifth: 10, damage: null }),
      ],
      pulp: {
        attacksPerRound: null,
        combat: [
          attack("Brawl", { value: 80, half: 40, fifth: 16 }),
          attack("Knife", { value: 70, half: 35, fifth: 14 }),
        ],
        talents: [
          { name: "Alert", description: "Never surprised in combat" },
          { name: "Tough Guy", description: "Soaks up damage" },
        ],
        hp: 20,
        luck: 45,
      },
    });

  test("a classic import takes the standard profile, a Pulp one the Pulp profile, under the same name", async () => {
    await importCharacters(
      [pulpCharacter(), makeCharacter({ name: "Plain" })],
      { folderName: "Book", notify: false },
    );
    assert.deepEqual(created.map((a) => a.name).sort(), ["Plain", "Pulp Hero"]);
    assert.ok(
      created.every((a) => a.flags["coc-pdf-importer"].era === "classic"),
    );
    created.length = 0;
    await importCharacters([pulpCharacter()], {
      folderName: "Book",
      notify: false,
      pulp: true,
    });
    assert.deepEqual(
      created.map((a) => [a.name, a.flags["coc-pdf-importer"].era]),
      [["Pulp Hero", "pulp"]],
    );
  });

  // A pre-gen whose sheet carries a PULP ADJUSTMENTS box.
  const pregen = () =>
    makeCharacter({
      name: "Ada Lark",
      age: 30,
      background: [{ title: "Treasured Possession", text: "a locket." }],
      skills: { "Survival (Desert)": 30, Climb: 40 },
      combat: [
        attack("Brawl", { value: 30, half: 15, fifth: 6 }),
        attack("Knife", { value: 30, half: 15, fifth: 6, damage: "1D4" }),
        attack("Dodge", { value: 30, half: 15, fifth: 6, damage: null }),
      ],
      pulp: {
        attacksPerRound: null,
        combat: [],
        talents: [{ name: "Endurance", description: "Bonus die to CON." }],
        hp: 23,
        luck: null,
        adjustments: {
          archetype: "Adventurer",
          characteristics: { EDU: 90 },
          san: null,
          skills: {
            "Fighting (Brawl)": 60,
            "Firearms (Handgun)": 40,
            Survival: 60,
            "Drive Auto": 40,
          },
          choices: [
            "Core Characteristic: change DEX or APP to 90.",
            "If DEX 90: Dodge 45%.",
          ],
        },
      },
    });

  test("a Pulp import applies a pre-gen's PULP ADJUSTMENTS and notes its choices", async () => {
    await importCharacters([pregen()], { notify: false, pulp: true });
    const a = created[0];
    assert.equal(a.type, "character");
    assert.equal(a.system.infos.archetype, "Adventurer");
    assert.equal(a.system.characteristics.edu.value, 90);
    assert.equal(a.system.attribs.hp.value, 23);
    assert.equal(
      a.system.notes,
      "Pulp adjustments to choose:\n" +
        "Core Characteristic: change DEX or APP to 90.\n" +
        "If DEX 90: Dodge 45%.",
    );
    const skill = (name: string) =>
      a.items.find((i: any) => i.type === "skill" && i.name === name);
    assert.equal(skill("Survival (Desert)").system.base, "60");
    assert.equal(skill("Drive Auto").system.base, "40");
    assert.equal(skill("Firearms (Handgun)").system.base, "40");
    // Brawl and the knife shared the Brawl value; both take the new one.
    assert.equal(skill("Fighting (Brawl)").system.base, "60");
    const knife = a.items.find((i: any) => i.name === "Knife");
    assert.equal(knife.system.skill.main.name, "Fighting (Brawl)");
    assert.equal(skill("Dodge").system.base, "30");
    assert.ok(a.items.some((i: any) => i.type === "talent"));
  });

  test("a classic import ignores the box", async () => {
    await importCharacters([pregen()], { notify: false });
    const a = created[0];
    assert.equal(a.system.notes, undefined);
    assert.equal(a.system.infos.archetype, undefined);
    assert.notEqual(a.system.characteristics.edu?.value, 90);
    const skill = (name: string) =>
      a.items.find((i: any) => i.type === "skill" && i.name === name);
    assert.equal(skill("Survival (Desert)").system.base, "30");
    assert.equal(skill("Drive Auto"), undefined);
  });

  test("a re-import in the other era replaces the actor under its id", async () => {
    await importCharacters([pulpCharacter()], {
      folderName: "Book",
      notify: false,
    });
    const classic = created[0];
    await importCharacters([pulpCharacter()], {
      folderName: "Book",
      notify: false,
      pulp: true,
    });
    assert.equal(created.length, 2);
    assert.equal(created[1].id, classic.id);
    assert.equal(created[1].system.attribs.hp.value, 20);
  });

  test("a Pulp-only stat block imports only in a Pulp import, without its label", async () => {
    const option = () => makeCharacter({ name: "Pulp Option: Fog Pack" });
    await importCharacters([option(), makeCharacter({ name: "Plain" })], {
      folderName: "Book",
      notify: false,
    });
    assert.deepEqual(
      created.map((a) => a.name),
      ["Plain"],
    );
    created.length = 0;
    await importCharacters([option()], {
      folderName: "Book",
      notify: false,
      pulp: true,
    });
    assert.deepEqual(
      created.map((a) => a.name),
      ["Fog Pack"],
    );
  });

  test("pulp combat replaces same-named profiles, keeps the others, adds new ones; pulp HP/Luck apply", async () => {
    await importCharacters([pulpCharacter()], {
      folderName: "Book",
      notify: false,
      pulp: true,
    });
    const variant = created.find((a) => a.name === "Pulp Hero")!;
    const weapons = variant.items.filter((i: any) => i.type === "weapon");
    const byName = Object.fromEntries(weapons.map((w: any) => [w.name, w]));
    assert.ok(byName["Knife"], "pulp-only attack added");
    const skillOf = (name: string) =>
      variant.items.find(
        (i: any) => i.type === "skill" && new RegExp(name, "i").test(i.name),
      );
    assert.equal(skillOf("Brawl").system.base, "80");
    assert.equal(skillOf("Dodge").system.base, "50");
    assert.equal(variant.system.attribs.hp.value, 20);
    assert.equal(variant.system.attribs.lck.value, 45);
    // A classic import keeps the standard values.
    created.length = 0;
    await importCharacters([pulpCharacter()], {
      folderName: "Book",
      notify: false,
    });
    const standard = created.find((a) => a.name === "Pulp Hero")!;
    assert.equal(
      standard.items.find(
        (i: any) => i.type === "skill" && /Brawl/i.test(i.name),
      ).system.base,
      "60",
    );
    assert.equal(standard.system.attribs.hp, undefined);
  });

  test("pulp talents use a same-named world talent (case-insensitive) with the book description, or an inline talent", async () => {
    (globalThis as any).game.items = {
      filter: (p: any) =>
        [
          {
            name: "alert",
            type: "talent",
            img: "alert.svg",
            system: {
              source: "Pulp Cthulhu",
              type: { combat: true },
              description: { value: "Full rules text.", keeper: "GM only" },
            },
          },
          { name: "Alert", type: "weapon" },
        ].filter(p),
    };
    await importCharacters([pulpCharacter()], {
      folderName: "Book",
      notify: false,
      pulp: true,
    });
    const variant = created.find((a) => a.name === "Pulp Hero")!;
    const talents = variant.items.filter((i: any) => i.type === "talent");
    assert.deepEqual(
      talents.map((t: any) => t.name),
      ["alert", "Tough Guy"],
    );
    // The world item keeps its icon, category and keeper notes but reads as the book does.
    assert.equal(talents[0].img, "alert.svg");
    assert.equal(talents[0].system.type.combat, true);
    assert.equal(
      talents[0].system.description.value,
      "Never surprised in combat",
    );
    assert.equal(talents[0].system.description.keeper, "GM only");
    assert.equal(talents[1].system.description.value, "Soaks up damage"); // inline
    assert.equal(talents[1].system.type.other, true);
    // A classic import gets no talents.
    created.length = 0;
    await importCharacters([pulpCharacter()], {
      folderName: "Book",
      notify: false,
    });
    const standard = created.find((a) => a.name === "Pulp Hero")!;
    assert.equal(
      standard.items.filter((i: any) => i.type === "talent").length,
      0,
    );
  });
});

describe("importCharacters — into a pack", () => {
  const PACK = "world.test-book-actors";
  const pack = (): Target => ({
    pack: PACK,
    type: "Actor",
    folders: () => folders.filter((f) => f.pack === PACK),
    documents: () => world.filter((a) => a.pack === PACK),
  });

  test("chapters are folders at the pack's top level, with no book folder", async () => {
    await importCharacters(
      [
        makeCharacter({ name: "Testa", chapter: "Chapter 1: Test Land" }),
        makeCharacter({ name: "Testb", chapter: "Appendix A: Test Foes" }),
      ],
      { folderName: "Test Book", notify: false, target: pack() },
    );
    assert.deepEqual(
      folders.map((f) => [f.name, f.folder, f.pack]),
      [
        ["Chapter 1: Test Land", null, PACK],
        ["Appendix A: Test Foes", null, PACK],
      ],
    );
    assert.ok(folders[0].sort < folders[1].sort); // printed order
    assert.ok(created.every((a) => a.pack === PACK));
    assert.equal(created[0].folder, folders[0].id);
  });

  test("actors carry their chapter in a module flag", async () => {
    await importCharacters(
      [makeCharacter({ name: "Testa", chapter: "Chapter 1: Test Land" })],
      { notify: false, target: pack() },
    );
    assert.equal(
      created[0].flags["coc-pdf-importer"].chapter,
      "Chapter 1: Test Land",
    );
  });

  test("a re-import keeps the actor's id and its embedded items' ids", async () => {
    const character = () =>
      makeCharacter({
        name: "Testa",
        chapter: "Chapter 1: Test Land",
        skills: { Climb: 40, "Spot Hidden": 55 },
        combat: [attack("Odd Gadget", { value: 35 })],
      });
    await importCharacters([character()], { notify: false, target: pack() });
    const first = created[0];
    await importCharacters([character()], { notify: false, target: pack() });
    const second = created[1];
    assert.equal(second.id, first.id);
    const ids = (a: any) => a.items.map((i: any) => [i.name, i._id]);
    assert.deepEqual(ids(second), ids(first));
    assert.equal(
      new Set(ids(first).map((p: any) => p[1])).size,
      first.items.length,
    );
    // The custom weapon links its backing skill by that stable id.
    const weapon = item(second, "Odd Gadget");
    const skill = second.items.find(
      (i: any) => i._id === weapon.system.skill.main.id,
    );
    assert.ok(skill);
  });

  test("new actors take the ids of same-named world actors to adopt", async () => {
    await importCharacters(
      [
        makeCharacter({ name: "Testa" }),
        makeCharacter({
          name: "Testb",
          pulp: { combat: [], talents: [] } as any,
        }),
      ],
      {
        notify: false,
        target: pack(),
        adopt: [
          { id: "worldTesta00001", name: "Testa" },
          { id: "worldTestb00001", name: "Testb" },
          { id: "worldOther00001", name: "Someone Else" },
        ],
      },
    );
    assert.equal(created.find((a) => a.name === "Testa").id, "worldTesta00001");
    assert.equal(created.find((a) => a.name === "Testb").id, "worldTestb00001");
    assert.equal(created.length, 2);
  });

  test("a pack import leaves world actors alone", async () => {
    world.push({
      name: "Testa",
      folder: null,
      delete: async () => assert.fail("world actor deleted"),
    });
    await importCharacters([makeCharacter({ name: "Testa" })], {
      notify: false,
      target: pack(),
    });
    assert.equal(created[0].pack, PACK);
  });
});
