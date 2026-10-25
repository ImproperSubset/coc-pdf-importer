import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { flatten, mergeDocument, resolve, unsetKey } from "./merge.ts";

// A made-up NPC as a pack entry, a loaded copy and a base all share.
const npc = (over: any = {}): any => ({
  _id: "Actor00000000001",
  name: "Testa",
  folder: "Folder0000000001",
  sort: 0,
  ownership: { default: 0 },
  _stats: { createdTime: 1, modifiedTime: 1 },
  system: {
    attribs: { hp: { value: 10, max: 10 }, san: { value: 50 } },
    description: { keeper: "<p>Old notes.</p>" },
    ...over.system,
  },
  items: over.items ?? [
    {
      _id: "Skill00000000001",
      type: "skill",
      name: "Climb",
      system: { value: 40 },
    },
    {
      _id: "Weapon0000000001",
      type: "weapon",
      name: "Odd Gadget",
      system: { damage: "1D6", skill: "Skill00000000001" },
    },
  ],
  flags: {
    CoC7: { cocidFlag: { id: "a.npc.testa" } },
    "coc-pdf-importer": { chapter: "Chapter 1: Test Land" },
  },
});

const set = (doc: any, path: string, value: unknown) => {
  const keys = path.split(".");
  let o = doc;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys.at(-1)!] = value;
  return doc;
};

describe("mergeDocument", () => {
  test("applies what only the pack changed and keeps what only play changed", () => {
    const base = npc();
    const world = set(npc(), "system.attribs.hp.value", 4); // a wound
    const pack = set(npc(), "system.description.keeper", "<p>Fixed notes.</p>");
    const m = mergeDocument(base, world, pack);
    assert.deepEqual(m.set, {
      "system.description.keeper": "<p>Fixed notes.</p>",
    });
    assert.equal(m.applied, 1);
    assert.equal(m.kept, 1);
    assert.deepEqual(m.conflicts, []);
  });

  test("a field both changed is a conflict, with all three values", () => {
    const base = npc();
    const world = set(npc(), "system.attribs.hp.max", 12);
    const pack = set(npc(), "system.attribs.hp.max", 11);
    const m = mergeDocument(base, world, pack);
    assert.deepEqual(m.set, {});
    assert.deepEqual(m.conflicts, [
      {
        itemId: null,
        itemName: null,
        path: "system.attribs.hp.max",
        world: 12,
        pack: 11,
        base: 10,
      },
    ]);
  });

  test("ids, folder, sort, ownership, timestamps and this module's flags are left alone", () => {
    const world = npc();
    world.folder = "Elsewhere0000001";
    world.sort = 5;
    world.ownership = { default: 2 };
    world._stats.modifiedTime = 99;
    const pack = npc();
    pack.flags["coc-pdf-importer"].chapter = "Chapter 2: Moved";
    const m = mergeDocument(npc(), world, pack);
    assert.deepEqual(m.set, {});
    assert.equal(m.applied + m.kept + m.conflicts.length, 0);
  });

  test("CoC7's sheet and play flags are left alone, on actors and their items", () => {
    const world = npc();
    world.system.flags = { locked: false, panelKeeper: true };
    world.items[0].system.flags = { developement: true };
    const pack = npc();
    pack.system.flags = { locked: true, panelKeeper: false };
    const m = mergeDocument(null, world, pack);
    assert.deepEqual(m.conflicts, []);
    assert.deepEqual(m.set, {});
  });

  test("an empty object matches one holding only ignored keys", () => {
    const world = npc();
    world.flags = {};
    const pack = npc();
    pack.flags = { "coc-pdf-importer": { chapter: "Appendix B: Test Lore" } };
    const m = mergeDocument(world, world, pack);
    assert.deepEqual(m.unset, []);
    assert.equal(m.applied + m.conflicts.length, 0);
  });

  test("embedded items merge field by field, by id", () => {
    const base = npc();
    const world = npc();
    world.items[0].system.value = 45; // an improvement check
    const pack = npc();
    pack.items[1].system.damage = "1D8"; // a corrected damage
    const m = mergeDocument(base, world, pack);
    assert.deepEqual(m.items.update, [
      { _id: "Weapon0000000001", "system.damage": "1D8" },
    ]);
    assert.equal(m.kept, 1);
  });

  test("items the pack adds are created, items it drops are deleted", () => {
    const base = npc();
    const pack = npc();
    pack.items.push({
      _id: "Skill00000000002",
      type: "skill",
      name: "Swim",
      system: { value: 30 },
    });
    pack.items = pack.items.filter((i: any) => i.name !== "Odd Gadget");
    const m = mergeDocument(base, npc(), pack);
    assert.deepEqual(
      m.items.create.map((i: any) => i.name),
      ["Swim"],
    );
    assert.deepEqual(m.items.delete, ["Weapon0000000001"]);
  });

  test("items play added stay, and items play removed stay removed", () => {
    const world = npc();
    world.items.push({
      _id: "Gift000000000001",
      type: "item",
      name: "Lantern",
      system: {},
    });
    world.items = world.items.filter((i: any) => i.name !== "Climb");
    const m = mergeDocument(npc(), world, npc());
    assert.deepEqual(m.items, { create: [], update: [], delete: [] });
    assert.equal(m.kept, 2);
  });

  test("an item play removed but the pack changed is a conflict", () => {
    const world = npc();
    world.items = world.items.filter((i: any) => i.name !== "Climb");
    const pack = set(npc(), "items.0.system.value", 50);
    const m = mergeDocument(npc(), world, pack);
    assert.equal(m.conflicts.length, 1);
    assert.equal(m.conflicts[0].itemName, "Climb");
    assert.equal(m.conflicts[0].world, undefined);
  });

  test("an untouched copy's items pair by type and name and update in place", () => {
    const world = npc({
      items: [
        {
          _id: "OldClimb00000001",
          type: "skill",
          name: "Climb",
          system: { value: 40 },
        },
        {
          _id: "OldSwim000000001",
          type: "skill",
          name: "Swim",
          system: { value: 20 },
        },
      ],
    });
    const pack = npc();
    pack.items[0].system.value = 45;
    const m = mergeDocument(world, world, pack, { pairByName: true });
    assert.deepEqual(m.items.update, [
      { _id: "OldClimb00000001", "system.value": 45 },
    ]);
    assert.deepEqual(m.items.delete, ["OldSwim000000001"]); // the import has no Swim
    assert.deepEqual(
      m.items.create.map((i: any) => i.name),
      ["Odd Gadget"],
    );
    assert.deepEqual(m.conflicts, []);
  });

  test("without a base every difference is a conflict, items paired by type and name", () => {
    // A world copy from before packs: random embedded ids.
    const world = npc({
      items: [
        {
          _id: "OldClimb00000001",
          type: "skill",
          name: "Climb",
          system: { value: 45 },
        },
        {
          _id: "OldGadget0000001",
          type: "weapon",
          name: "Odd Gadget",
          system: { damage: "1D6", skill: "OldClimb00000001" },
        },
      ],
    });
    const m = mergeDocument(null, world, npc());
    // The weapon's skill link compares equal once ids are paired.
    assert.deepEqual(
      m.conflicts.map((c) => [c.itemId, c.path, c.world, c.pack]),
      [["OldClimb00000001", "system.value", 45, 40]],
    );
    assert.equal(m.conflicts[0].base, undefined);
    assert.ok(!("base" in m.conflicts[0]));
    // The new base uses the world's ids.
    assert.deepEqual(
      m.newBase.items.map((i: any) => i._id),
      ["OldClimb00000001", "OldGadget0000001"],
    );
    assert.equal(m.newBase.items[1].system.skill, "OldClimb00000001");
  });
});

describe("mergeDocument without a base", () => {
  // A world copy edited after an import made before packs, as the T-Rex was:
  // a wound, values the system worked out, the Keeper's art and token.
  const edited = (type: string) => {
    const world = npc();
    world.type = type;
    world.system.attribs.hp.value = 30;
    world.system.attribs.mp = { max: 13 };
    world.img = "worlds/test/beast.webp";
    world.prototypeToken = {
      width: 4,
      texture: { src: "worlds/test/beast-token.webp" },
    };
    const pack = npc();
    pack.type = type;
    pack.system.attribs.mp = { max: null };
    pack.img = "icons/default.svg";
    pack.prototypeToken = { width: 1, texture: { src: "icons/default.svg" } };
    pack.system.description.keeper = "<p>Fixed notes.</p>";
    return { world, pack };
  };

  test("an NPC keeps its play fields and system-worked values, and takes the import's other fields", () => {
    const { world, pack } = edited("npc");
    const m = mergeDocument(null, world, pack);
    assert.deepEqual(m.conflicts, []);
    assert.deepEqual(m.set, {
      "system.description.keeper": "<p>Fixed notes.</p>",
    });
    assert.equal(m.kept, 5); // HP, MP max, portrait, token width and art
  });

  test("an investigator's other differences are still asked about", () => {
    const { world, pack } = edited("character");
    const m = mergeDocument(null, world, pack);
    assert.deepEqual(m.set, {});
    assert.deepEqual(
      m.conflicts.map((c) => c.path),
      ["system.description.keeper"],
    );
  });

  test("with a base, a field both changed is still asked about", () => {
    const base = npc();
    const world = set(npc(), "system.description.keeper", "<p>Mine.</p>");
    const pack = set(npc(), "system.description.keeper", "<p>Fixed.</p>");
    assert.equal(mergeDocument(base, world, pack).conflicts.length, 1);
  });
});

describe("resolve", () => {
  test("a conflict keeps the world value unless the pack's is chosen", () => {
    const world = set(npc(), "system.attribs.hp.max", 12);
    const pack = set(npc(), "system.attribs.hp.max", 11);
    const m = mergeDocument(npc(), world, pack);
    assert.deepEqual(resolve(m, [false]).set, {});
    assert.deepEqual(resolve(m, [true]).set, { "system.attribs.hp.max": 11 });
    assert.deepEqual(m.set, {}); // the merge itself is unchanged
  });

  test("a chosen item conflict updates, re-adds or deletes the item", () => {
    const world = npc();
    world.items[0].system.value = 45;
    world.items = world.items.filter((i: any) => i.name !== "Odd Gadget");
    const pack = npc();
    pack.items[0].system.value = 50;
    pack.items[1].system.damage = "1D8";
    const m = mergeDocument(npc(), world, pack);
    assert.equal(m.conflicts.length, 2);
    const r = resolve(m, [true, true]);
    assert.deepEqual(r.items.update, [
      { _id: "Skill00000000001", "system.value": 50 },
    ]);
    assert.deepEqual(
      r.items.create.map((i: any) => i.name),
      ["Odd Gadget"],
    );
  });
});

describe("helpers", () => {
  test("flatten keeps arrays whole", () => {
    assert.deepEqual(
      [...flatten({ system: { list: [1, 2], a: { b: 1 } } })],
      [
        ["system.list", [1, 2]],
        ["system.a.b", 1],
      ],
    );
  });

  test("unsetKey is Foundry's deletion key", () => {
    assert.equal(unsetKey("system.a.b"), "system.a.-=b");
    assert.equal(unsetKey("name"), "-=name");
  });
});
