// Unit tests for finding, renaming and creating a book's top-level folder.
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { ensureBookFolder } from "./folders.ts";

describe("ensureBookFolder", () => {
  let folders: any[];
  const folder = (d: any) => {
    const f: any = { ...d };
    f.update = async (u: any) => {
      if (u.name) f.name = u.name;
      if (u.flags) f.flags = { ...(f.flags ?? {}), ...u.flags };
    };
    folders.push(f);
    return f;
  };

  beforeEach(() => {
    folders = [];
    let n = 0;
    (globalThis as any).game = {
      folders: { find: (p: any) => folders.find(p) },
    };
    (globalThis as any).Folder = {
      create: async (d: any) => folder({ id: "f" + ++n, ...d }),
    };
  });
  afterEach(() => {
    delete (globalThis as any).game;
    delete (globalThis as any).Folder;
  });

  const flagOf = (f: any) => f.flags?.["coc-pdf-importer"]?.sourceFile;

  test("creates a folder named for the title, flagged with the file", async () => {
    const f = await ensureBookFolder("Actor", "Test Book", "test_book_v1");
    assert.equal(f!.name, "Test Book");
    assert.equal(f!.type, "Actor");
    assert.equal(flagOf(f), "test_book_v1");
  });

  test("renames an older import's file-named folder and flags it", async () => {
    const old = folder({ id: "old", name: "test_book_v1", type: "Actor" });
    const f = await ensureBookFolder("Actor", "Test Book", "test_book_v1");
    assert.equal(f, old);
    assert.equal(old.name, "Test Book");
    assert.equal(flagOf(old), "test_book_v1");
    assert.equal(folders.length, 1);
  });

  test("finds the flagged folder whatever it is now called, and renames it", async () => {
    const flagged = folder({
      id: "x",
      name: "Some Old Title",
      type: "Item",
      flags: { "coc-pdf-importer": { sourceFile: "test_book_v1" } },
    });
    folder({ id: "y", name: "Test Book", type: "Item" }); // not this one
    const f = await ensureBookFolder("Item", "Test Book", "test_book_v1");
    assert.equal(f, flagged);
    assert.equal(flagged.name, "Test Book");
  });

  test("ignores folders of the other type and nested folders", async () => {
    folder({ id: "a", name: "test_book_v1", type: "Item" });
    folder({
      id: "b",
      name: "test_book_v1",
      type: "Actor",
      folder: { id: "z" },
    });
    const f = await ensureBookFolder("Actor", "Test Book", "test_book_v1");
    assert.equal(folders.length, 3);
    assert.equal(f!.name, "Test Book");
    assert.equal(f!.folder, undefined);
  });
});
