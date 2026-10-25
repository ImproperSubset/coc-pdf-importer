// Load, unload and update against a mock of the Foundry pieces they touch:
// world collections, packs, folders, the document classes and DialogV2. All
// names and text are made up.
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  bookFromPack,
  offerUpdate,
  registerMenus,
  syncBook,
  unloadBook,
} from "./chapters.ts";
import { SCOPE } from "./packs.ts";

const SOURCE = "cha99999_test_book";
const clone = (v: any) => structuredClone(v);

let n: number;
let folders: any[];
let world: Record<string, Map<string, any>>;
let packs: any[];
let dialogs: { kind: string; content: string }[];
let answer: (content: string) => any;
let hooks: Record<string, (...args: any[]) => void>;

function setPath(obj: any, path: string, value: unknown) {
  const keys = path.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  const last = keys.at(-1)!;
  if (last.startsWith("-=")) delete o[last.slice(2)];
  else o[last] = value;
}

// A document: its source data, with the methods syncBook calls.
function makeDoc(data: any, where: { pack?: any; type: string }): any {
  const doc: any = {
    get id() {
      return doc._source._id;
    },
    get name() {
      return doc._source.name;
    },
    get flags() {
      return doc._source.flags ?? {};
    },
    get _stats() {
      return doc._source._stats;
    },
    get folder() {
      const id = doc._source.folder;
      const list = where.pack ? where.pack.folderList : folders;
      return list.find((f: any) => f.id === id) ?? null;
    },
    _source: clone(data),
    toObject: () => clone(doc._source),
    update: async (u: any) => {
      for (const [k, v] of Object.entries(u)) setPath(doc._source, k, v);
      doc._source._stats.modifiedTime += 1000;
    },
    createEmbeddedDocuments: async (_t: string, list: any[]) =>
      doc._source.items.push(...clone(list)),
    updateEmbeddedDocuments: async (_t: string, list: any[]) => {
      for (const { _id, ...u } of list) {
        const it = doc._source.items.find((i: any) => i._id === _id);
        for (const [k, v] of Object.entries(u)) setPath(it, k, v);
      }
    },
    deleteEmbeddedDocuments: async (_t: string, ids: string[]) => {
      doc._source.items = doc._source.items.filter(
        (i: any) => !ids.includes(i._id),
      );
    },
  };
  return doc;
}

function makePack(meta: any): any {
  const pack: any = {
    metadata: { packageType: "world", ...meta },
    collection: `world.${meta.name}`,
    documentName: meta.type,
    title: meta.label,
    folder: null,
    locked: false,
    entries: new Map<string, any>(),
    folderList: [] as any[],
    configure: async () => {},
    setFolder: async (f: any) => (pack.folder = f),
    getDocuments: async (q: any = {}) =>
      [...pack.entries.values()].filter(
        (d) => !q._id__in || q._id__in.includes(d.id),
      ),
    getIndex: async () => new Map([...pack.entries.keys()].map((k) => [k, {}])),
    deleteCompendium: async () => packs.splice(packs.indexOf(pack), 1),
  };
  return pack;
}

function docClass(type: string) {
  const store = (opts: any) =>
    opts?.pack
      ? packs.find((p) => p.collection === opts.pack).entries
      : world[type];
  return {
    createDocuments: async (list: any[], opts: any = {}) => {
      const pack = opts.pack && packs.find((p) => p.collection === opts.pack);
      for (const d of list) {
        const data = {
          _stats: { createdTime: 1000, modifiedTime: 1000 },
          ...clone(d),
        };
        store(opts).set(data._id, makeDoc(data, { pack, type }));
      }
    },
    deleteDocuments: async (ids: string[], opts: any = {}) => {
      for (const id of ids) store(opts).delete(id);
    },
  };
}

function worldCollection(type: string) {
  return {
    get: (id: string) => world[type].get(id),
    filter: (p: any) => [...world[type].values()].filter(p),
    fromCompendium: (doc: any, opts: any) => {
      const data = doc.toObject();
      if (!opts.keepId) delete data._id;
      if (opts.clearFolder) delete data.folder;
      delete data._stats;
      return data;
    },
  };
}

// The book's packs, with one chapter folder in the actor pack and a type
// folder in the item pack.
function seedBook() {
  const actors = makePack({
    name: "test-actors",
    label: "Test Book Actors",
    type: "Actor",
    flags: { [SCOPE]: { sourceFile: SOURCE, role: "actors" } },
  });
  const items = makePack({
    name: "test-items",
    label: "Test Book Items",
    type: "Item",
    flags: { [SCOPE]: { sourceFile: SOURCE, role: "items" } },
  });
  packs.push(actors, items);
  actors.folderList.push(
    { id: "pf1", name: "Chapter 1: Test Land", sort: 100000, folder: null },
    { id: "pf2", name: "Appendix A: Test Foes", sort: 200000, folder: null },
  );
  items.folderList.push({ id: "pf3", name: "Tomes", sort: 0, folder: null });
  const actor = (id: string, name: string, chapter: string, folder: string) =>
    makeDoc(
      {
        _id: id,
        name,
        type: "npc",
        folder,
        _stats: { createdTime: 1000, modifiedTime: 1000 },
        system: {
          attribs: { hp: { value: 10, max: 10 } },
          description: { keeper: "<p>Old notes.</p>" },
        },
        items: [
          {
            _id: "Climb" + id,
            type: "skill",
            name: "Climb",
            system: { value: 40 },
          },
        ],
        flags: { [SCOPE]: { chapter } },
      },
      { pack: actors, type: "Actor" },
    );
  actors.entries.set(
    "Testa00000000001",
    actor("Testa00000000001", "Testa", "Chapter 1: Test Land", "pf1"),
  );
  actors.entries.set(
    "Testb00000000001",
    actor("Testb00000000001", "Testb", "Appendix A: Test Foes", "pf2"),
  );
  items.entries.set(
    "Tome000000000001",
    makeDoc(
      {
        _id: "Tome000000000001",
        name: "Test Tome",
        type: "book",
        folder: "pf3",
        _stats: { createdTime: 1000, modifiedTime: 1000 },
        system: { description: { keeper: "<p>A tome.</p>" } },
        flags: { [SCOPE]: { chapter: "Appendix A: Test Foes" } },
      },
      { pack: items, type: "Item" },
    ),
  );
  const folder = {
    id: "cf1",
    name: "Test Book",
    type: "Compendium",
    folder: null,
  };
  folders.push(folder);
  actors.folder = folder;
  items.folder = folder;
  return bookFromPack(actors)!;
}

beforeEach(() => {
  n = 0;
  folders = [];
  world = { Actor: new Map(), Item: new Map() };
  packs = [];
  dialogs = [];
  answer = () => true;
  hooks = {};
  (globalThis as any).game = {
    folders: {
      find: (p: any) => folders.find(p),
      filter: (p: any) => folders.filter(p),
    },
    actors: worldCollection("Actor"),
    items: worldCollection("Item"),
    packs: {
      find: (p: any) => packs.find(p),
      filter: (p: any) => packs.filter(p),
      get: (c: string) => packs.find((p) => p.collection === c),
    },
    settings: {
      get: () => ({}),
      set: async () => {},
    },
    user: { isGM: true },
    release: { generation: 14 },
  };
  (globalThis as any).ui = {
    notifications: { info: () => {}, error: () => {} },
  };
  (globalThis as any).Folder = {
    create: async (d: any) => {
      const f: any = { id: "wf" + ++n, folder: null, ...d };
      f.update = async (u: any) => Object.assign(f, u);
      f.delete = async () => folders.splice(folders.indexOf(f), 1);
      folders.push(f);
      return f;
    },
  };
  (globalThis as any).Actor = docClass("Actor");
  (globalThis as any).Item = docClass("Item");
  (globalThis as any).Hooks = {
    on: (name: string, fn: any) => (hooks[name] = fn),
  };
  (globalThis as any).foundry = {
    documents: {
      collections: {
        CompendiumCollection: {
          createCompendium: async (meta: any) => {
            const pack = makePack(meta);
            packs.push(pack);
            return pack;
          },
        },
      },
    },
    applications: {
      api: {
        DialogV2: {
          confirm: async (o: any) => {
            dialogs.push({ kind: "confirm", content: o.content });
            return answer(o.content);
          },
          wait: async (o: any) => {
            dialogs.push({ kind: "review", content: o.content });
            const choice = answer(o.content);
            if (choice === null) return "cancel";
            // The Apply callback reads radio values from the form.
            const form = {
              elements: {
                namedItem: (name: string) => ({
                  value: choice === "pack" ? "pack" : "world",
                  name,
                }),
              },
            };
            return o.buttons[0].callback({}, { form });
          },
        },
      },
    },
  };
});

afterEach(() => {
  for (const k of ["game", "ui", "Folder", "Actor", "Item", "Hooks", "foundry"])
    delete (globalThis as any)[k];
});

const worldActor = (id: string) => world.Actor.get(id);
const folderOf = (doc: any) => folders.find((f) => f.id === doc._source.folder);
const basePack = (role: string) =>
  packs.find((p) => p.metadata.flags?.[SCOPE]?.role === role);

describe("Load chapter", () => {
  test("copies the chapter's actors in under their pack ids, in the book's chapter folder", async () => {
    const book = seedBook();
    await syncBook(book, "Chapter 1: Test Land");
    assert.deepEqual([...world.Actor.keys()], ["Testa00000000001"]);
    const chapter = folderOf(worldActor("Testa00000000001"));
    assert.equal(chapter.name, "Chapter 1: Test Land");
    assert.equal(chapter.sort, 100000);
    const root = folders.find((f) => f.id === chapter.folder);
    assert.equal(root.name, "Test Book");
    assert.equal(root.type, "Actor");
    assert.equal(root.flags[SCOPE].sourceFile, SOURCE);
    assert.equal(root.sorting, "m");
    // Its base is saved in the hidden actor base pack.
    assert.ok(basePack("actor-bases").entries.has("Testa00000000001"));
    assert.equal(world.Item.size, 0); // the tome is in another chapter
  });

  test("an appendix's items load with it, into their type folder", async () => {
    const book = seedBook();
    await syncBook(book, "Appendix A: Test Foes");
    const tome = world.Item.get("Tome000000000001");
    assert.equal(folderOf(tome).name, "Tomes");
    assert.ok(basePack("item-bases").entries.has("Tome000000000001"));
  });

  test("loading again applies the import's fixes and keeps play changes", async () => {
    const book = seedBook();
    await syncBook(book, "Chapter 1: Test Land");
    await worldActor("Testa00000000001").update({
      "system.attribs.hp.value": 3,
    });
    await book.actors.entries
      .get("Testa00000000001")
      .update({ "system.description.keeper": "<p>Fixed notes.</p>" });
    await syncBook(book, "Chapter 1: Test Land");
    const src = worldActor("Testa00000000001")._source;
    assert.equal(src.system.attribs.hp.value, 3);
    assert.equal(src.system.description.keeper, "<p>Fixed notes.</p>");
    assert.equal(dialogs.length, 0);
    // The new base is the pack entry, so the next update asks nothing.
    assert.equal(
      basePack("actor-bases").entries.get("Testa00000000001")._source.system
        .description.keeper,
      "<p>Fixed notes.</p>",
    );
  });

  test("a field both changed is reviewed, keeping the world value unless the import's is picked", async () => {
    const book = seedBook();
    await syncBook(book, "Chapter 1: Test Land");
    await worldActor("Testa00000000001").update({
      "system.attribs.hp.max": 12,
    });
    await book.actors.entries
      .get("Testa00000000001")
      .update({ "system.attribs.hp.max": 11 });
    answer = () => "world";
    await syncBook(book, "Chapter 1: Test Land");
    assert.match(dialogs[0].content, /Testa — Hit points \(max\)/);
    assert.match(dialogs[0].content, /it was 10 when loaded/);
    assert.equal(
      worldActor("Testa00000000001")._source.system.attribs.hp.max,
      12,
    );
    // Kept once, it is not asked again while the import stays the same.
    await syncBook(book, "Chapter 1: Test Land");
    assert.equal(dialogs.length, 1);
    // A later pick of the import's value takes it.
    await book.actors.entries
      .get("Testa00000000001")
      .update({ "system.attribs.hp.max": 13 });
    answer = () => "pack";
    await syncBook(book, "Chapter 1: Test Land");
    assert.equal(
      worldActor("Testa00000000001")._source.system.attribs.hp.max,
      13,
    );
  });

  test("cancelling the review changes nothing", async () => {
    const book = seedBook();
    await syncBook(book, "Chapter 1: Test Land");
    await worldActor("Testa00000000001").update({
      "system.attribs.hp.max": 12,
    });
    const entry = book.actors.entries.get("Testa00000000001");
    await entry.update({ "system.attribs.hp.max": 11 });
    await entry.update({ "system.description.keeper": "<p>Fixed.</p>" });
    answer = () => null;
    await syncBook(book, null); // also would load Testb
    assert.equal(world.Actor.size, 1);
    assert.equal(
      worldActor("Testa00000000001")._source.system.description.keeper,
      "<p>Old notes.</p>",
    );
  });

  test("Update loaded chapters loads nothing new", async () => {
    const book = seedBook();
    await syncBook(book, "Chapter 1: Test Land");
    await syncBook(book, null, { create: false });
    assert.equal(world.Actor.size, 1);
  });
});

describe("world copies from before packs", () => {
  // A world copy the pack adopted: same id, random embedded ids.
  const adopt = (book: any, modifiedTime: number) => {
    const entry = book.actors.entries.get("Testa00000000001").toObject();
    entry.items = [
      {
        _id: "OldClimb00000001",
        type: "skill",
        name: "Climb",
        system: { value: 45 },
      },
    ];
    entry._stats = { createdTime: 1000, modifiedTime };
    entry.folder = null;
    world.Actor.set(entry._id, makeDoc(entry, { type: "Actor" }));
  };

  test("an untouched copy takes the import whole", async () => {
    const book = seedBook();
    adopt(book, 1100);
    await syncBook(book, "Chapter 1: Test Land", { create: false });
    assert.equal(dialogs.length, 0);
    assert.deepEqual(
      worldActor("Testa00000000001")._source.items.map((i: any) => [
        i._id,
        i.system.value,
      ]),
      [["ClimbTesta00000000001", 40]],
    );
  });

  test("a copy changed since lists its differences as of unknown origin", async () => {
    const book = seedBook();
    adopt(book, 999999);
    answer = () => "world";
    await syncBook(book, "Chapter 1: Test Land", { create: false });
    assert.equal(dialogs.length, 1);
    assert.match(
      dialogs[0].content,
      /can&#39;t tell whether play or the import|can't tell whether play or the import/,
    );
    assert.match(dialogs[0].content, /Testa — Climb: value/);
    assert.equal(
      worldActor("Testa00000000001")._source.items[0].system.value,
      45,
    );
  });
});

describe("Unload", () => {
  test("deletes the chapter's world copies, their bases and empty folders", async () => {
    const book = seedBook();
    await syncBook(book, null);
    await unloadBook(book, "Chapter 1: Test Land");
    assert.equal(dialogs[0].kind, "confirm");
    assert.deepEqual([...world.Actor.keys()], ["Testb00000000001"]);
    assert.ok(!basePack("actor-bases").entries.has("Testa00000000001"));
    assert.ok(!folders.some((f) => f.name === "Chapter 1: Test Land"));
    assert.ok(folders.some((f) => f.name === "Appendix A: Test Foes"));
  });

  test("unloading the last chapter deletes the base packs and the book's folders", async () => {
    const book = seedBook();
    await syncBook(book, null);
    await unloadBook(book, null);
    assert.equal(world.Actor.size + world.Item.size, 0);
    assert.equal(basePack("actor-bases"), undefined);
    assert.equal(basePack("item-bases"), undefined);
    assert.deepEqual(
      folders.map((f) => f.type),
      ["Compendium"],
    );
  });

  test("a declined confirmation unloads nothing", async () => {
    const book = seedBook();
    await syncBook(book, null);
    answer = () => false;
    await unloadBook(book, null);
    assert.equal(world.Actor.size, 2);
  });
});

describe("menus", () => {
  test("chapter folders of a book's actor pack get Load and Unload", () => {
    seedBook();
    registerMenus();
    const entries: any[] = [];
    hooks.getFolderContextOptions({ collection: packs[0] }, entries);
    assert.deepEqual(
      entries.map((e) => e.label),
      ["Load chapter", "Unload chapter"],
    );
    const other: any[] = [];
    hooks.getFolderContextOptions({ collection: (game as any).actors }, other);
    assert.equal(other.length, 0);
  });

  test("entries take v13's form on v13", () => {
    (game as any).release.generation = 13;
    registerMenus();
    const entries: any[] = [];
    hooks.getCompendiumContextOptions({}, entries);
    assert.deepEqual(
      entries.map((e) => e.name),
      ["Load all chapters", "Unload all chapters", "Update loaded chapters"],
    );
    assert.equal(typeof entries[0].callback, "function");
    assert.equal(typeof entries[0].condition, "function");
  });
});

describe("after a re-import", () => {
  test("offers to update loaded chapters, and updates them on yes", async () => {
    const book = seedBook();
    await syncBook(book, "Chapter 1: Test Land");
    await book.actors.entries
      .get("Testa00000000001")
      .update({ "system.description.keeper": "<p>Fixed notes.</p>" });
    await offerUpdate(SOURCE);
    assert.equal(dialogs.at(-1)!.kind, "confirm");
    assert.equal(
      worldActor("Testa00000000001")._source.system.description.keeper,
      "<p>Fixed notes.</p>",
    );
    assert.equal(world.Actor.size, 1); // nothing new loaded
  });

  test("asks nothing when no chapter is loaded", async () => {
    seedBook();
    await offerUpdate(SOURCE);
    assert.equal(dialogs.length, 0);
  });
});
