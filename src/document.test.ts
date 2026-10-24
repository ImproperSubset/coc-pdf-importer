// Unit tests for the Foundry world-import layer: building Foundry item documents
// from internal PulpItems (pulpItemDoc) and creating them (createPulpItems).
// Foundry's globals (game, ui, Item, Folder) are replaced with a lightweight mock
// harness that records what would be created.
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { createPulpItems, pulpItemDoc } from "./document.ts";
import type { PulpItem } from "./pulp.ts";

const talent = (name: string): PulpItem => ({
  kind: "talent",
  name,
  category: "physical",
  description: "x.",
});

describe("pulpItemDoc", () => {
  test("builds a talent item matching the CoC7 schema", () => {
    const item = pulpItemDoc(
      {
        kind: "talent",
        name: "Big Lift",
        // Already capitalized by the parser; the doc builder only escapes.
        description: "Lifts & holds <stuff>.",
        category: "physical",
      },
      "Test Source",
    );
    assert.equal(item.type, "talent");
    assert.equal(item.name, "Big Lift");
    assert.equal(item.img, undefined); // icon assigned at creation, not from source
    assert.equal(item.system.source, "Test Source");
    // Escaped, not <p>-wrapped.
    assert.equal(
      item.system.description.value,
      "Lifts &amp; holds &lt;stuff&gt;.",
    );
    assert.equal(item.system.description.notes, "");
    assert.deepEqual(item.system.adjustments, []);
    assert.deepEqual(item.system.type, {
      physical: true,
      mental: false,
      combat: false,
      miscellaneous: false,
      basic: false,
      insane: false,
      other: false,
    });
  });

  test("builds an archetype item, resolving skill names to CoCID itemKeys", () => {
    const item = pulpItemDoc(
      {
        kind: "archetype",
        name: "Hard Boiled",
        description: "Tough & <streetwise>.",
        coreCharacteristics: ["con"],
        bonusPoints: 100,
        talents: 2,
        skills: ["Fighting (Brawl)", "Law", "Art/Craft (any)"],
        suggestedOccupations: ["Gangster", "Boxer"],
        suggestedTraits: ["cynical", "violent"],
      },
      "Test Source",
    );
    assert.equal(item.type, "archetype");
    assert.equal(item.name, "Hard Boiled");
    assert.equal(item.img, undefined);
    assert.equal(item.system.source, "Test Source");
    assert.equal(item.system.bonusPoints, 100);
    assert.equal(item.system.talents, 2);
    assert.equal(item.system.coreCharacteristics.con, true);
    assert.equal(item.system.coreCharacteristics.str, false);
    assert.equal(
      item.system.description.value,
      "Tough &amp; &lt;streetwise&gt;.",
    );
    // The list arrays are reassembled into strings for the Foundry HTML fields.
    assert.equal(item.system.suggestedOccupations, "Gangster, Boxer");
    assert.equal(item.system.suggestedTraits, "cynical, violent");
    // Skill names resolved to CoCIDs here, at the import boundary.
    assert.deepEqual(item.system.itemKeys, [
      "i.skill.fighting-brawl",
      "i.skill.law",
      "i.skill.art-craft-any",
    ]);
    assert.equal(item.system.coreCharacteristicsFormula.value, "(1D6+13)*5");
    assert.deepEqual(item.system.itemDocuments, []);
  });

  test("builds a hybrid spell with legacy costs and empty costList", () => {
    const item = pulpItemDoc(
      {
        kind: "spell",
        name: "Fog Test",
        castingTime: "1 round",
        costs: {
          magicPoints: "4",
          sanity: "1d2",
          power: "",
          hitPoints: "",
          others: "",
        },
        note: "",
        description: "Makes fog & <mist>.",
      },
      "Test Source",
    );
    assert.equal(item.type, "spell");
    assert.equal(item.system.castingTime, "1 round");
    assert.equal(item.system.costs.magicPoints, "4");
    assert.equal(item.system.costs.sanity, "1d2");
    assert.deepEqual(item.system.costList, []);
    assert.match(
      item.system.description.value,
      /Makes fog &amp; &lt;mist&gt;\./,
    );
    assert.equal(item.system.source, "Test Source");
  });

  test("builds a book with keeper relevance/spells and empty itemKeys", () => {
    const item = pulpItemDoc(
      {
        kind: "tome",
        name: "Red Book",
        language: "English",
        author: "Ada",
        date: "1920",
        physical: "Quarto.",
        link: "Library, page 1.",
        description: "A curious volume.",
        relevance: "finale clue.",
        sanityLoss: "1D6",
        cthulhuMythos: { initial: 2, final: 5 },
        mythosRating: 18,
        study: { necessary: 10, units: "CoC7.weeks" },
        spells: "Fog Test",
        region: "",
      },
      "Test Source",
    );
    assert.equal(item.type, "book");
    assert.equal(item.system.language, "English");
    assert.equal(item.system.sanityLoss, "1d6");
    assert.equal(item.system.mythosRating, 18);
    assert.deepEqual(item.system.gains.cthulhuMythos, { initial: 2, final: 5 });
    assert.equal(item.system.type.mythos, true);
    assert.deepEqual(item.system.itemKeys, []);
    assert.match(item.system.description.keeper, /Relevance: finale clue/);
    assert.match(item.system.description.keeper, /Spells: Fog Test/);
  });

  test("builds artefact as item or weapon; keeper holds full text", () => {
    const mundane = pulpItemDoc(
      {
        kind: "artefact",
        name: "Charm",
        link: "Desk.",
        description: "A small charm.",
        keeper: "Link: Desk. Full mechanics here.",
        isWeapon: false,
        region: "",
      },
      "Test",
    );
    assert.equal(mundane.type, "item");
    assert.match(mundane.system.description.keeper, /Full mechanics/);
    const weapon = pulpItemDoc(
      {
        kind: "artefact",
        name: "Blade",
        link: "Armory.",
        description: "",
        keeper: "Deals 1D8 damage.",
        isWeapon: true,
        region: "Peru",
      },
      "Test",
    );
    assert.equal(weapon.type, "weapon");
    assert.equal(weapon.system.properties.spcl, true);
  });

  test("builds an occupation item, expanding sparse skill points over every characteristic", () => {
    const item = pulpItemDoc(
      {
        kind: "occupation",
        name: "Test Occupation",
        description: "Flavor text.",
        occupationSkillPoints: {
          edu: { multiplier: 2, selected: true, optional: false },
          dex: { multiplier: 2, selected: true, optional: true },
        },
        creditRating: { min: 9, max: 60 },
        skills: ["Climb", "Art/Craft (any)"],
        groups: [{ options: 1, skills: ["Charm", "Persuade"] }],
        personal: 2,
        personalText: "other skills as personal specialties",
        special: "",
      },
      "Test Source",
    );
    assert.equal(item.type, "occupation");
    assert.equal(item.system.source, "Test Source");
    assert.equal(item.system.type.pulp, true);
    assert.deepEqual(item.system.occupationSkillPoints.edu, {
      multiplier: 2,
      selected: true,
      optional: false,
    });
    assert.deepEqual(item.system.occupationSkillPoints.str, {
      multiplier: null,
      selected: false,
      optional: false,
    });
    assert.deepEqual(item.system.creditRating, { min: 9, max: 60 });
    assert.deepEqual(item.system.itemKeys, [
      "i.skill.climb",
      "i.skill.art-craft-any",
    ]);
    assert.deepEqual(item.system.groups, [
      {
        options: 1,
        itemDocuments: [],
        itemKeys: ["i.skill.charm", "i.skill.persuade"],
      },
    ]);
    assert.equal(item.system.personal, 2);
    assert.equal(
      item.system.personalText,
      "other skills as personal specialties",
    );
  });

  test("an occupation's Special clause is folded into its description as a second paragraph", () => {
    const item = pulpItemDoc(
      {
        kind: "occupation",
        name: "Test Occupation",
        description: "Flavor text.",
        occupationSkillPoints: {},
        creditRating: { min: 0, max: 0 },
        skills: [],
        groups: [],
        personal: 0,
        personalText: "",
        special: "limited Sanity loss immunity",
      },
      "Test Source",
    );
    assert.match(item.system.description.value, /Flavor text\.<\/p>/);
    assert.match(
      item.system.description.value,
      /Special: limited Sanity loss immunity/,
    );
  });

  test("builds a skill item from an altered/new skill write-up", () => {
    const item = pulpItemDoc(
      {
        kind: "oldWestSkill",
        name: "Test Skill",
        base: "10%",
        description: "Does a thing.",
      },
      "Test Source",
    );
    assert.equal(item.type, "skill");
    assert.equal(item.system.skillName, "Test Skill");
    assert.equal(item.system.base, "10");
    assert.match(item.system.description.value, /Does a thing\./);
  });

  test("builds a weapon item, splitting a literal '+DB' into the addb flag", () => {
    const item = pulpItemDoc(
      {
        kind: "oldWestWeapon",
        name: "Test Knife",
        skill: "Fighting (Brawl)",
        damage: "1D4+DB",
        baseRange: "Touch",
        usesPerRound: "1",
        bullets: null,
        malfunction: null,
        cost: "$2",
        availability: "C",
        impale: true,
        thrown: false,
        ranged: false,
        auto: false,
      },
      "Test Source",
    );
    assert.equal(item.type, "weapon");
    assert.equal(item.system.skill.main.name, "Fighting (Brawl)");
    assert.equal(item.system.range.normal.damage, "1D4");
    assert.equal(item.system.range.normal.value, "0"); // Touch
    assert.equal(item.system.properties.addb, true);
    assert.equal(item.system.properties.impl, true);
    assert.deepEqual(item.system.price, { downDarkerTrails: "$2" });
  });

  test("splits a compound firearm row's damage across normal/long/extreme range", () => {
    const item = pulpItemDoc(
      {
        kind: "oldWestWeapon",
        name: "Test Shotgun",
        skill: "Firearms (Rifle/Shotgun)",
        damage: "4D6/2D6/1D6",
        baseRange: "10",
        usesPerRound: "1 or 2",
        bullets: 2,
        malfunction: 99,
        cost: "$25",
        availability: "U",
        impale: false,
        thrown: false,
        ranged: true,
        auto: false,
      },
      "Test Source",
    );
    assert.equal(item.system.range.normal.damage, "4D6");
    assert.equal(item.system.range.long.damage, "2D6");
    assert.equal(item.system.range.extreme.damage, "1D6");
  });
});

describe("artefact weapons", () => {
  const artefact = (weapon: any, keeper = "Test text."): any => ({
    kind: "artefact",
    name: "Test Weapon",
    link: "",
    description: "A test weapon.",
    keeper,
    isWeapon: true,
    weapon: {
      skill: "",
      damage: "",
      range: "",
      usesMax: "",
      shots: null,
      impale: false,
      burn: false,
      damageBonus: "",
      ranged: null,
      ...weapon,
    },
    region: "",
  });
  const compendium = new Map<string, any>([
    [
      ".38 automatic",
      {
        name: ".38 Automatic",
        system: {
          range: {
            normal: { value: "15", damage: "1D10" },
            long: { value: "0" },
            extreme: { value: "0" },
          },
          usesPerRound: { normal: "1", max: "3" },
          properties: { rngd: true, impl: true },
        },
      },
    ],
    [
      "knife, small (switchblade, etc.)",
      {
        name: "Knife, Small (switchblade, etc.)",
        system: {
          range: { normal: { value: "0", damage: "1D4" } },
          usesPerRound: { normal: "1", max: "" },
          properties: { rngd: false, addb: true },
        },
      },
    ],
  ]);

  test("the text's stats win; the equivalent supplies range and uses", () => {
    const doc = pulpItemDoc(
      artefact({
        skill: "Firearms (Handgun)",
        damage: "1D8",
        burn: true,
        ranged: true,
      }),
      "Test Book",
      compendium,
    );
    assert.equal(doc.type, "weapon");
    assert.equal(doc.system.skill.main.name, "i.skill.firearms-handgun");
    assert.deepEqual(doc.system.range.normal, { value: "15", damage: "1D8" });
    assert.equal(doc.system.usesPerRound.max, "3");
    assert.equal(doc.system.properties.rngd, true);
    assert.equal(doc.system.properties.burn, true);
    assert.equal(doc.system.properties.impl, false); // not from the equivalent
  });

  test("a thrown dagger takes a knife's damage and the thrown profile", () => {
    const doc = pulpItemDoc(
      artefact({ skill: "Throw", ranged: true }, "Used as throwing daggers."),
      "Test Book",
      compendium,
    );
    assert.equal(doc.system.skill.main.name, "i.skill.throw");
    assert.deepEqual(doc.system.range.normal, {
      value: "@STR/5",
      damage: "1D4",
    });
    assert.equal(doc.system.properties.ahdb, true);
    assert.equal(doc.system.properties.addb, false);
  });

  test("a weapon with no damage takes no damage bonus from its equivalent", () => {
    const doc = pulpItemDoc(
      artefact({ skill: "Fighting (Brawl)", ranged: false }),
      "Test Book",
      compendium,
    );
    assert.equal(doc.system.range.normal.damage, "");
    assert.equal(doc.system.properties.addb, false);
    assert.equal(doc.system.properties.rngd, false);
  });

  test("without an equivalent, only the text's stats are used", () => {
    const doc = pulpItemDoc(
      artefact({
        skill: "Fighting (Whip)",
        damage: "1D3",
        range: "12/3",
        damageBonus: "half",
        ranged: true,
      }),
      "Test Book",
      new Map(),
    );
    assert.deepEqual(doc.system.range.normal, { value: "12/3", damage: "1D3" });
    assert.equal(doc.system.properties.ahdb, true);
    assert.equal(doc.system.properties.spcl, true);
  });
});

describe("createPulpItems", () => {
  let created: any[];
  let folders: any[];
  let world: any[];
  let notes: string[];

  const parentOf = (f: any) => f?.folder?.id ?? f?.folder ?? null;
  const byName = (name: string) => folders.find((f) => f.name === name);

  beforeEach(() => {
    created = [];
    folders = [];
    world = [];
    notes = [];
    let n = 0;
    (globalThis as any).game = {
      folders: { find: (p: any) => folders.find(p) },
      items: { filter: (p: any) => world.filter(p) },
    };
    (globalThis as any).ui = {
      notifications: {
        info: (m: string) => notes.push(m),
        error: (m: string) => notes.push(m),
      },
    };
    (globalThis as any).Folder = {
      create: async (d: any) => {
        const f = { id: "f" + ++n, ...d };
        folders.push(f);
        return f;
      },
    };
    (globalThis as any).Item = {
      // Mirror Foundry: `keepId` creates the item under the given `_id`.
      create: async (d: any, opts?: { keepId?: boolean }) => {
        const it: any = {
          ...d,
          id: opts?.keepId && d._id ? d._id : "it" + ++n,
          deleted: false,
        };
        it.delete = async () => {
          it.deleted = true;
          world.splice(world.indexOf(it), 1);
        };
        created.push(it);
        world.push(it);
        return it;
      },
    };
  });

  afterEach(() => {
    for (const k of ["game", "ui", "Item", "Folder"])
      delete (globalThis as any)[k];
  });

  test("creates a document folder with a per-type subfolder holding the items", async () => {
    const res = await createPulpItems([talent("Alpha"), talent("Bravo")], {
      folderName: "Book",
      notify: false,
    });
    assert.equal(res.created, 2);
    const parent = byName("Book");
    const sub = byName("Talents");
    assert.equal(parent.type, "Item");
    assert.equal(parentOf(parent), null); // parent is top-level
    assert.equal(parentOf(sub), parent.id); // subfolder under the document folder
    assert.ok(created.every((i) => i.folder === sub.id)); // items in the subfolder
    // Icon is assigned at creation, per kind.
    assert.ok(
      created.every((i) => i.img === "systems/CoC7/assets/icons/skills.svg"),
    );
    assert.equal(notes.length, 0); // notify: false
  });

  test("files each item kind into its own subfolder", async () => {
    const archetype: PulpItem = {
      kind: "archetype",
      name: "Hero",
      description: "d.",
      coreCharacteristics: [],
      bonusPoints: 100,
      talents: 2,
      skills: [],
      suggestedOccupations: [],
      suggestedTraits: [],
    };
    await createPulpItems([talent("Alpha"), archetype], {
      folderName: "Book",
      notify: false,
    });
    const talents = byName("Talents");
    const archetypes = byName("Archetypes");
    assert.equal(parentOf(talents), byName("Book").id);
    assert.equal(parentOf(archetypes), byName("Book").id);
    assert.equal(created.find((i) => i.name === "Alpha").folder, talents.id);
    assert.equal(created.find((i) => i.name === "Hero").folder, archetypes.id);
  });

  test("reuses existing document + subfolders instead of recreating them", async () => {
    folders.push({ id: "p", name: "Book", type: "Item", folder: null });
    folders.push({
      id: "s",
      name: "Talents",
      type: "Item",
      folder: { id: "p" },
    });
    await createPulpItems([talent("Alpha")], {
      folderName: "Book",
      notify: false,
    });
    assert.equal(folders.length, 2); // none created
    assert.equal(created[0].folder, "s");
  });

  test("re-import replaces a same-named item in its subfolder", async () => {
    folders.push({ id: "p", name: "Book", type: "Item", folder: null });
    folders.push({
      id: "s",
      name: "Talents",
      type: "Item",
      folder: { id: "p" },
    });
    const old: any = {
      id: "old",
      name: "Alpha",
      folder: { id: "s" },
      deleted: false,
    };
    old.toObject = () => ({
      _id: "old",
      name: "Alpha",
      type: "talent",
      img: "custom/icon.webp",
      ownership: { default: 2 },
      sort: 300,
    });
    old.delete = async () => {
      old.deleted = true;
      world.splice(world.indexOf(old), 1);
    };
    world.push(old);
    await createPulpItems([talent("Alpha")], {
      folderName: "Book",
      notify: false,
    });
    assert.equal(old.deleted, true); // pre-existing Alpha removed
    assert.equal(world.filter((i) => i.name === "Alpha").length, 1); // exactly one
    const fresh = created.find((i) => i.name === "Alpha");
    assert.equal(fresh.deleted, false); // new one kept
    assert.equal(fresh.id, "old"); // under the old id
    assert.deepEqual(fresh.ownership, { default: 2 }); // Keeper-owned fields kept
    assert.equal(fresh.sort, 300);
    assert.equal(fresh.img, "systems/CoC7/assets/icons/skills.svg"); // icon per kind
  });

  test("no items creates nothing and no folders", async () => {
    const res = await createPulpItems([], {
      folderName: "Book",
      notify: false,
    });
    assert.equal(res.created, 0);
    assert.equal(folders.length, 0);
  });

  test("notifies by default and reports the created count", async () => {
    await createPulpItems([talent("Alpha")], { folderName: "Book" });
    assert.equal(notes.length, 1);
    assert.match(notes[0], /1 items/);
  });

  test("a failed Item.create is counted as failed without aborting the rest", async () => {
    const ok = (globalThis as any).Item.create;
    (globalThis as any).Item.create = async (d: any) => {
      if (d.name === "Bravo") throw new Error("boom");
      return ok(d);
    };
    const res = await createPulpItems(
      [talent("Alpha"), talent("Bravo"), talent("Charlie")],
      { folderName: "Book" },
    );
    assert.equal(res.created, 2);
    assert.equal(res.failed, 1);
    assert.deepEqual(
      created.map((i) => i.name),
      ["Alpha", "Charlie"],
    );
    assert.match(notes[0], /2 items, 1 failed/);
  });

  test("tomes and artefacts without a region sit directly in their type folder", async () => {
    await createPulpItems(
      [
        {
          kind: "tome",
          name: "Plain Tome",
          language: "English",
          author: "",
          date: "",
          physical: "",
          link: "",
          description: "d.",
          relevance: "",
          sanityLoss: "",
          cthulhuMythos: { initial: 0, final: 0 },
          mythosRating: 0,
          study: { necessary: 0, units: "" },
          spells: "",
          region: "",
        },
        {
          kind: "artefact",
          name: "Plain Charm",
          link: "",
          description: "d.",
          keeper: "",
          isWeapon: false,
          region: "",
        },
      ],
      { folderName: "Book", notify: false },
    );
    assert.equal(
      created.find((i) => i.name === "Plain Tome").folder,
      byName("Tomes").id,
    );
    assert.equal(
      created.find((i) => i.name === "Plain Charm").folder,
      byName("Artefacts").id,
    );
    assert.equal(folders.length, 3); // Book, Tomes, Artefacts — no region folders
  });

  test("each item cites its book and page in its Keeper notes and source field", async () => {
    await createPulpItems(
      [
        { ...talent("Alpha"), page: 40, printedPage: 39 },
        {
          kind: "artefact",
          name: "Test Charm",
          link: "",
          description: "A small charm.",
          keeper: "Old notes.",
          isWeapon: false,
          region: "",
          page: 50,
          printedPage: 49,
        },
      ],
      { folderName: "Book", source: "Test Book", notify: false },
    );
    const alpha = created.find((i) => i.name === "Alpha");
    assert.equal(alpha.system.source, "Test Book, p. 39");
    assert.equal(
      alpha.system.description.keeper,
      "<p>Source: Test Book, p. 39</p>",
    );
    const charm = created.find((i) => i.name === "Test Charm");
    assert.equal(
      charm.system.description.keeper,
      "<p>Source: Test Book, p. 49</p><p>Old notes.</p>",
    );
  });

  test("paragraph breaks in a description become separate paragraphs", async () => {
    await createPulpItems(
      [
        { ...talent("Alpha"), description: "First part.\n\nSecond part." },
        talent("Bravo"),
      ],
      { folderName: "Book", notify: false },
    );
    assert.equal(
      created.find((i) => i.name === "Alpha").system.description.value,
      "<p>First part.</p><p>Second part.</p>",
    );
    assert.equal(
      created.find((i) => i.name === "Bravo").system.description.value,
      "x.",
    );
  });

  test("files spells, tomes, and artefacts into typed subfolders", async () => {
    await createPulpItems(
      [
        {
          kind: "spell",
          name: "Fog Test",
          castingTime: "1 round",
          costs: {
            magicPoints: "1",
            sanity: "1",
            power: "",
            hitPoints: "",
            others: "",
          },
          note: "",
          description: "Makes fog.",
        },
        {
          kind: "tome",
          name: "Fog Tome",
          language: "English",
          author: "A Author",
          date: "1900",
          physical: "Pamphlet.",
          link: "Shelf, page 1.",
          description: "Thin booklet.",
          relevance: "none.",
          sanityLoss: "1D4",
          cthulhuMythos: { initial: 1, final: 2 },
          mythosRating: 9,
          study: { necessary: 2, units: "CoC7.weeks" },
          spells: "Fog Test",
          region: "Egypt",
        },
        {
          kind: "artefact",
          name: "Fog Charm",
          link: "Desk, page 2.",
          description: "A small charm.",
          keeper: "Link: Desk, page 2. A small charm with no combat use.",
          isWeapon: false,
          region: "Peru",
        },
      ],
      { folderName: "Masks", notify: false },
    );
    assert.ok(byName("Spells"));
    assert.ok(byName("Tomes"));
    assert.ok(byName("Artefacts"));
    assert.ok(byName("Peru"));
    assert.ok(byName("Egypt"));
    assert.equal(parentOf(byName("Spells")), byName("Masks").id);
    assert.equal(parentOf(byName("Peru")), byName("Artefacts").id);
    assert.equal(parentOf(byName("Egypt")), byName("Tomes").id);
    assert.equal(created.find((i) => i.name === "Fog Test").type, "spell");
    assert.equal(created.find((i) => i.name === "Fog Tome").type, "book");
    assert.equal(created.find((i) => i.name === "Fog Charm").type, "item");
    assert.equal(
      created.find((i) => i.name === "Fog Charm").folder,
      byName("Peru").id,
    );
    assert.equal(
      created.find((i) => i.name === "Fog Test").img,
      "systems/CoC7/assets/icons/pentagram-rose.svg",
    );
  });
});
