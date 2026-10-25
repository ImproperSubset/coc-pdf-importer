import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { bookOf, ensureBookPack, packName } from "./packs.ts";

let packs: any[];
let folders: any[];
let settings: Record<string, any>;

function makePack(meta: any): any {
  const pack: any = {
    metadata: { packageType: "world", ...meta },
    collection: `world.${meta.name}`,
    title: meta.label,
    folder: null,
    locked: false,
    configured: [] as any[],
    configure: async (c: any) => pack.configured.push(c),
    setFolder: async (f: any) => (pack.folder = f),
  };
  return pack;
}

beforeEach(() => {
  packs = [];
  folders = [];
  settings = { collectionSortingModes: {} };
  let n = 0;
  (globalThis as any).game = {
    packs: {
      find: (p: any) => packs.find(p),
      filter: (p: any) => packs.filter(p),
    },
    folders: {
      find: (p: any) => folders.find(p),
      filter: (p: any) => folders.filter(p),
    },
    settings: {
      get: (_ns: string, key: string) => settings[key],
      set: async (_ns: string, key: string, v: any) => (settings[key] = v),
    },
  };
  (globalThis as any).Folder = {
    create: async (d: any) => {
      const f: any = { id: "f" + ++n, folder: null, ...d };
      f.update = async (u: any) => Object.assign(f, u);
      folders.push(f);
      return f;
    },
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
  };
});

afterEach(() => {
  for (const k of ["game", "Folder", "foundry"]) delete (globalThis as any)[k];
});

describe("book packs", () => {
  test("a pack name is the file name's slug and the role", () => {
    assert.equal(
      packName("cha99999_-_A Test Book v1.0", "actors"),
      "cha99999-a-test-book-v1-0-actors",
    );
  });

  test("a new pack is flagged, named for the book and filed in its folder", async () => {
    const pack = await ensureBookPack("A Test Book", "cha99999_test", "actors");
    assert.equal(pack.metadata.label, "A Test Book Actors");
    assert.equal(pack.metadata.type, "Actor");
    assert.deepEqual(bookOf(pack), {
      sourceFile: "cha99999_test",
      role: "actors",
    });
    assert.equal(pack.folder.name, "A Test Book");
    assert.equal(pack.folder.type, "Compendium");
    // Its top level (the chapter folders) sorts manually.
    assert.equal(settings.collectionSortingModes[pack.collection], "m");
  });

  test("a re-import finds the flagged pack rather than making another", async () => {
    const first = await ensureBookPack("A Test Book", "cha99999_test", "items");
    const again = await ensureBookPack(
      "Renamed Book",
      "cha99999_test",
      "items",
    );
    assert.equal(again, first);
    assert.equal(packs.length, 1);
    assert.equal(first.folder.name, "Renamed Book");
  });

  test("base packs are filed in an Import records folder inside the book's", async () => {
    const actors = await ensureBookPack(
      "A Test Book",
      "cha99999_test",
      "actors",
    );
    const base = await ensureBookPack(
      "A Test Book",
      "cha99999_test",
      "actor-bases",
    );
    await ensureBookPack("A Test Book", "cha99999_test", "item-bases");
    assert.equal(base.folder.name, "Import records");
    assert.equal(base.folder.type, "Compendium");
    assert.equal(base.folder.folder, actors.folder.id);
    assert.equal(folders.filter((f) => f.name === "Import records").length, 1);
    assert.deepEqual(base.configured, []); // visible, as Foundry wants
  });

  test("a locked pack stops the import", async () => {
    const pack = await ensureBookPack("A Test Book", "cha99999_test", "actors");
    pack.locked = true;
    await assert.rejects(
      ensureBookPack("A Test Book", "cha99999_test", "actors"),
      /locked/,
    );
  });

  test("packs not flagged by this module are not a book's", () => {
    assert.equal(bookOf(makePack({ name: "other", flags: {} })), null);
    assert.equal(
      bookOf({
        metadata: {
          packageType: "module",
          flags: { "coc-pdf-importer": { sourceFile: "x", role: "actors" } },
        },
      }),
      null,
    );
  });
});
