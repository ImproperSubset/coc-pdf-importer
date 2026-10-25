// Loading a book's chapters from its packs into the world, unloading them, and
// updating loaded copies after a re-import. A world copy keeps its pack entry's
// id; its base (what was last loaded or applied) is kept in the book's base
// packs, and an update compares the three (see merge.ts).

// Foundry globals (game, ui, foundry, Hooks) are declared in ./foundry.d.ts.

import { ensureBookFolder } from "./folders.ts";
import { mergeDocument, resolve, unsetKey, type Merge } from "./merge.ts";
import { conflictNote, fieldLabel, shownValue } from "./review.ts";
import {
  BASE_ROLES,
  bookOf,
  bookPack,
  ensureBookPack,
  RECORDS_FOLDER,
  SCOPE,
  type PackRole,
} from "./packs.ts";
import {
  documentsUnder,
  ensureFolder,
  isWithin,
  parentId,
  worldTarget,
} from "./target.ts";

export interface Book {
  sourceFile: string;
  title: string;
  actors: any | null;
  items: any | null;
}

// A world copy last changed within this long of its creation counts as
// untouched since its import: the import's own follow-up updates take up to
// about 120 ms.
const UNTOUCHED_MS = 5000;

// The book a pack of this module's belongs to; its title is the book's
// compendium folder's name.
export function bookFromPack(pack: any): Book | null {
  const flag = bookOf(pack);
  if (!flag) return null;
  const actors = bookPack(flag.sourceFile, "actors");
  const items = bookPack(flag.sourceFile, "items");
  const title =
    pack.folder?.name ??
    String(pack.metadata?.label ?? flag.sourceFile).replace(
      / (Actors|Items|Actor import records|Item import records)$/,
      "",
    );
  return { sourceFile: flag.sourceFile, title, actors, items };
}

interface Kind {
  book: Book;
  type: "Actor" | "Item";
  pack: any;
  baseRole: PackRole;
  world: any; // game.actors or game.items
  cls: any; // Actor or Item
}

function kinds(book: Book): Kind[] {
  const out: Kind[] = [];
  if (book.actors)
    out.push({
      book,
      type: "Actor",
      pack: book.actors,
      baseRole: "actor-bases",
      world: (game as any).actors,
      cls: (globalThis as any).Actor,
    });
  if (book.items)
    out.push({
      book,
      type: "Item",
      pack: book.items,
      baseRole: "item-bases",
      world: (game as any).items,
      cls: (globalThis as any).Item,
    });
  return out;
}

// The pack entries of `chapter`, or of the whole book when it is null.
async function entriesOf(kind: Kind, chapter: string | null): Promise<any[]> {
  const docs: any[] = await kind.pack.getDocuments();
  return chapter === null
    ? docs
    : docs.filter((d) => d.flags?.[SCOPE]?.chapter === chapter);
}

// The names and sort values of a pack entry's folders, outermost first.
function folderChain(doc: any): { name: string; sort: number }[] {
  const chain: { name: string; sort: number }[] = [];
  for (let f = doc.folder; f && chain.length < 8; f = f.folder)
    chain.unshift({ name: f.name, sort: f.sort ?? 0 });
  return chain;
}

// The world folder mirroring a pack entry's folders, under the book's folder.
async function worldFolderFor(
  kind: Kind,
  book: Book,
  doc: any,
  cache: Map<string, Promise<FoundryFolder | null>>,
): Promise<FoundryFolder | null> {
  const root = await ensureBookFolder(kind.type, book.title, book.sourceFile);
  if (!root?.id) return null;
  let folder: FoundryFolder | null = root;
  let key = "";
  for (const { name, sort } of folderChain(doc)) {
    if (folder === root && root.sorting !== "m")
      await root.update?.({ sorting: "m" });
    key += `/${name}`;
    const parent: string | null = folder?.id ?? null;
    if (!cache.has(key))
      cache.set(key, ensureFolder(worldTarget(kind.type), name, parent, sort));
    folder = await cache.get(key)!;
  }
  return folder;
}

// --- bases ------------------------------------------------------------------

async function readBases(kind: Kind, ids: string[]): Promise<Map<string, any>> {
  const pack = bookPack(kind.book.sourceFile, kind.baseRole);
  if (!pack || !ids.length) return new Map();
  const docs: any[] = await pack.getDocuments({ _id__in: ids });
  return new Map(docs.map((d) => [d.id, d.toObject()]));
}

async function writeBases(kind: Kind, bases: any[]): Promise<void> {
  if (!bases.length) return;
  const { title, sourceFile } = kind.book;
  const pack = await ensureBookPack(title, sourceFile, kind.baseRole);
  const ids = bases.map((b) => b._id);
  const existing: any[] = await pack.getDocuments({ _id__in: ids });
  if (existing.length)
    await kind.cls.deleteDocuments(
      existing.map((d) => d.id),
      { pack: pack.collection },
    );
  await kind.cls.createDocuments(bases, {
    pack: pack.collection,
    keepId: true,
  });
}

async function deleteBases(kind: Kind, ids: string[]): Promise<void> {
  const pack = bookPack(kind.book.sourceFile, kind.baseRole);
  if (!pack || !ids.length) return;
  const existing: any[] = await pack.getDocuments({ _id__in: ids });
  if (existing.length)
    await kind.cls.deleteDocuments(
      existing.map((d) => d.id),
      { pack: pack.collection },
    );
}

// --- load and update ----------------------------------------------------------

interface Planned {
  kind: Kind;
  world: any;
  merge: Merge;
}

// The base a loaded copy is compared against: its saved base; else, for a copy
// untouched since an import made before packs, the copy itself; else none.
// Without a saved base, embedded items pair by type and name.
function baseFor(
  world: any,
  saved: any | undefined,
): { base: any | null; pairByName: boolean } {
  if (saved) return { base: saved, pairByName: false };
  const s = world._stats;
  if (s?.createdTime && s.modifiedTime - s.createdTime < UNTOUCHED_MS)
    return { base: world.toObject(), pairByName: true };
  return { base: null, pairByName: true };
}

// Load the entries of `chapter` (every entry when null) and update those
// already loaded. With `create` false, only loaded copies are updated.
export async function syncBook(
  book: Book,
  chapter: string | null,
  { create = true }: { create?: boolean } = {},
): Promise<void> {
  const toCreate: { kind: Kind; entries: any[] }[] = [];
  const planned: Planned[] = [];
  for (const kind of kinds(book)) {
    const entries = await entriesOf(kind, chapter);
    const loaded = entries.filter((e) => kind.world.get(e.id));
    const missing = entries.filter((e) => !kind.world.get(e.id));
    if (create && missing.length) toCreate.push({ kind, entries: missing });
    const bases = await readBases(
      kind,
      loaded.map((e) => e.id),
    );
    for (const entry of loaded) {
      const world = kind.world.get(entry.id);
      const { base, pairByName } = baseFor(world, bases.get(entry.id));
      const merge = mergeDocument(base, world.toObject(), entry.toObject(), {
        pairByName,
      });
      planned.push({ kind, world, merge });
    }
  }

  const conflicts = planned.reduce((n, p) => n + p.merge.conflicts.length, 0);
  let choices: boolean[][] = planned.map((p) =>
    p.merge.conflicts.map(() => false),
  );
  if (conflicts) {
    const picked = await reviewConflicts(planned);
    if (!picked) return; // cancelled: nothing changes
    choices = picked;
  }

  let created = 0;
  for (const { kind, entries } of toCreate) {
    const cache = new Map<string, Promise<FoundryFolder | null>>();
    const data = [];
    for (const entry of entries) {
      const d = kind.world.fromCompendium(entry, {
        keepId: true,
        clearFolder: true,
      });
      d.folder = (await worldFolderFor(kind, book, entry, cache))?.id ?? null;
      data.push(d);
    }
    await kind.cls.createDocuments(data, { keepId: true });
    await writeBases(
      kind,
      entries.map((e) => e.toObject()),
    );
    created += data.length;
  }

  let applied = 0;
  let kept = 0;
  let changed = 0;
  // Each document is updated on its own, and only an applied one gets its
  // new base: one that fails is compared afresh next time.
  const done: Planned[] = [];
  const failed: string[] = [];
  for (const [i, p] of planned.entries()) {
    const m = resolve(p.merge, choices[i]);
    try {
      if (await applyMerge(p.world, m)) changed++;
      applied += m.applied;
      kept += m.kept;
      done.push(p);
    } catch (err) {
      console.error(
        `coc-pdf-importer: failed to update "${p.world.name}"`,
        err,
      );
      failed.push(p.world.name);
    }
  }
  for (const kind of kinds(book))
    await writeBases(
      kind,
      done.filter((p) => p.kind.type === kind.type).map((p) => p.merge.newBase),
    );

  const parts = [
    created ? `loaded ${created}` : "",
    planned.length
      ? `updated ${changed} of ${planned.length} already loaded (${applied} fixes applied, ${kept} play changes kept${conflicts ? `, ${conflicts} reviewed` : ""})`
      : "",
    failed.length
      ? `${failed.length} failed to update (see console): ${failed.join(", ")}`
      : "",
  ].filter(Boolean);
  ui.notifications[failed.length ? "error" : "info"](
    `${book.title}: ${parts.join("; ") || "nothing to load"}.`,
  );
}

// An update with its removals (`-=key` keys) in the running Foundry's form:
// v14 deprecates them for a ForcedDeletion value at the key itself.
export function withDeletions(
  update: Record<string, unknown>,
): Record<string, unknown> {
  const Forced = (foundry as any).data?.operators?.ForcedDeletion;
  if (!Forced) return update;
  return Object.fromEntries(
    Object.entries(update).map(([key, value]) =>
      /(^|\.)-=/.test(key)
        ? [key.replace(/(^|\.)-=/, "$1"), new Forced()]
        : [key, value],
    ),
  );
}

async function applyMerge(doc: any, m: Merge): Promise<boolean> {
  const update = withDeletions({
    ...m.set,
    ...Object.fromEntries(m.unset.map((p) => [unsetKey(p), null])),
  });
  let changed = false;
  if (Object.keys(update).length) {
    await doc.update(update);
    changed = true;
  }
  if (m.items.create.length) {
    await doc.createEmbeddedDocuments("Item", m.items.create, { keepId: true });
    changed = true;
  }
  if (m.items.update.length) {
    await doc.updateEmbeddedDocuments(
      "Item",
      m.items.update.map((u) => withDeletions(u)),
    );
    changed = true;
  }
  if (m.items.delete.length) {
    await doc.deleteEmbeddedDocuments("Item", m.items.delete);
    changed = true;
  }
  return changed;
}

// After a PDF re-import, offer to update the world copies of the book's
// loaded chapters.
export async function offerUpdate(sourceFile: string): Promise<void> {
  const pack = bookPack(sourceFile, "actors") ?? bookPack(sourceFile, "items");
  const book = pack ? bookFromPack(pack) : null;
  if (!book || !(await anyLoaded(book))) return;
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: `Update ${book.title}` },
    content:
      `<p>Chapters of ${escapeHtml(book.title)} are loaded. Update their ` +
      `world copies from this import now?</p>` +
      `<p>The import's fixes are applied and changes made in play are kept; ` +
      `anything both changed is shown for review.</p>`,
  });
  if (ok) await guarded(() => syncBook(book, null, { create: false }));
}

// --- unload -------------------------------------------------------------------

export async function unloadBook(
  book: Book,
  chapter: string | null,
): Promise<void> {
  const loaded: { kind: Kind; ids: string[] }[] = [];
  for (const kind of kinds(book)) {
    const entries = await entriesOf(kind, chapter);
    loaded.push({
      kind,
      ids: entries.map((e) => e.id).filter((id) => kind.world.get(id)),
    });
  }
  const [actors, items] = [
    loaded.find((l) => l.kind.type === "Actor")?.ids.length ?? 0,
    loaded.find((l) => l.kind.type === "Item")?.ids.length ?? 0,
  ];
  if (!actors && !items) {
    ui.notifications.info(`${book.title}: nothing loaded to unload.`);
    return;
  }
  const what = chapter ?? "every chapter";
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: `Unload ${what}` },
    content:
      `<p>Delete the world copies of ${actors} actor(s) and ${items} item(s) ` +
      `from ${escapeHtml(what)} of ${escapeHtml(book.title)}?</p>` +
      `<p>Their play state (current HP, Sanity, notes on the copies) is lost. ` +
      `Tokens placed in scenes stop working until the chapter is loaded ` +
      `again, when they find their actors under the same ids.</p>`,
  });
  if (!ok) return;
  for (const { kind, ids } of loaded) {
    if (!ids.length) continue;
    await kind.cls.deleteDocuments(ids);
    await deleteBases(kind, ids);
  }
  await pruneWorldFolders(book);
  if (!(await anyLoaded(book))) await deleteBasePacks(book);
  ui.notifications.info(
    `${book.title}: unloaded ${actors} actor(s) and ${items} item(s).`,
  );
}

// Whether any of the book's pack entries has a world copy.
async function anyLoaded(book: Book): Promise<boolean> {
  for (const kind of kinds(book)) {
    const index = await kind.pack.getIndex();
    if ([...index.keys()].some((id: string) => kind.world.get(id))) return true;
  }
  return false;
}

async function deleteBasePacks(book: Book): Promise<void> {
  let folder: FoundryFolder | null = null;
  for (const role of BASE_ROLES) {
    const pack = bookPack(book.sourceFile, role);
    folder ??= pack?.folder ?? null;
    if (pack) await pack.deleteCompendium();
  }
  const emptied =
    folder?.name === RECORDS_FOLDER &&
    !game.packs?.filter((p: any) => p.folder?.id === folder!.id).length;
  if (emptied) await folder!.delete?.();
}

// Delete the book's world folders left empty, deepest first, the book's
// folder itself included once nothing is left in it.
async function pruneWorldFolders(book: Book): Promise<void> {
  for (const kind of kinds(book)) {
    const target = worldTarget(kind.type);
    const root = target
      .folders()
      .find((f) => (f.flags as any)?.[SCOPE]?.sourceFile === book.sourceFile);
    if (!root?.id) continue;
    const depth = (f: FoundryFolder) => {
      let d = 0;
      for (let id = f.id ?? null; id && id !== root.id && d < 8; d++) {
        const folder = target.folders().find((x) => x.id === id);
        id = folder ? parentId(folder) : null;
      }
      return d;
    };
    const tree = target
      .folders()
      .filter((f) => isWithin(target, f.id, root.id!))
      .sort((a, b) => depth(b) - depth(a));
    for (const folder of tree) {
      if (documentsUnder(target, folder.id!).length) continue;
      if (target.folders().some((f) => parentId(f) === folder.id)) continue;
      try {
        await folder.delete?.();
      } catch (err) {
        console.error(
          `coc-pdf-importer: failed to remove folder "${folder.name}"`,
          err,
        );
      }
    }
  }
}

// --- review dialog ------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Ask the Keeper, conflict by conflict, whether to keep the world value
// (the default) or take the pack's. Null when cancelled.
async function reviewConflicts(
  planned: Planned[],
): Promise<boolean[][] | null> {
  const rows: string[] = [];
  planned.forEach((p, d) => {
    p.merge.conflicts.forEach((c, i) => {
      const field =
        c.path === null
          ? (c.itemName ?? "An item")
          : fieldLabel(c.path, c.itemName);
      const keep =
        c.path === null
          ? c.world === undefined
            ? "Leave it off"
            : "Keep it"
          : `Keep the world's: ${shownValue(c.world)}`;
      const take =
        c.path === null
          ? c.world === undefined
            ? "Put it back from the import"
            : "Remove it"
          : `Take the import's: ${shownValue(c.pack)}`;
      rows.push(
        `<fieldset><legend>${escapeHtml(p.world.name)} — ${escapeHtml(field)}</legend>` +
          `<p class="hint">${escapeHtml(conflictNote(c))}</p>` +
          `<label><input type="radio" name="c-${d}-${i}" value="world" checked> ` +
          `${escapeHtml(keep)}</label><br>` +
          `<label><input type="radio" name="c-${d}-${i}" value="pack"> ` +
          `${escapeHtml(take)}</label></fieldset>`,
      );
    });
  });
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: "Review the update" },
    position: { width: 640 },
    content:
      `<p>The module can't tell on its own which of these to keep. ` +
      `Each keeps the world's value unless you pick the import's.</p>` +
      `<div class="coc-import-review" style="max-height: 60vh; overflow-y: auto;">${rows.join("")}</div>`,
    buttons: [
      {
        action: "apply",
        label: "Apply",
        default: true,
        callback: (_event: Event, button: any) => {
          const form = button.form as HTMLFormElement;
          return planned.map((p, d) =>
            p.merge.conflicts.map(
              (_c, i) =>
                (form.elements.namedItem(`c-${d}-${i}`) as RadioNodeList)
                  ?.value === "pack",
            ),
          );
        },
      },
      { action: "cancel", label: "Cancel" },
    ],
  });
  return Array.isArray(result) ? result : null;
}

// --- menus ----------------------------------------------------------------------

// A context menu entry in the running Foundry generation's form.
function menuEntry(
  label: string,
  icon: string,
  visible: (target: HTMLElement) => boolean,
  run: (target: HTMLElement) => unknown,
): any {
  if ((game.release?.generation ?? 13) >= 14)
    return {
      label,
      icon: `fa-solid ${icon}`,
      visible,
      onClick: (_event: Event, target: HTMLElement) => run(target),
    };
  return {
    name: label,
    icon: `<i class="fa-solid ${icon}"></i>`,
    condition: visible,
    callback: (target: HTMLElement) => run(target),
  };
}

// Run an action, reporting a failure instead of leaving it in the console.
function guarded(action: () => Promise<void>): Promise<void> {
  return action().catch((err) => {
    console.error("coc-pdf-importer:", err);
    ui.notifications.error(`coc-pdf-importer: ${err?.message ?? err}`);
  });
}

async function folderOf(target: HTMLElement): Promise<any> {
  const uuid = (target.closest(".directory-item") as HTMLElement | null)
    ?.dataset.uuid;
  return uuid ? fromUuid(uuid) : null;
}

export function registerMenus(): void {
  // A chapter folder in a book's actor pack.
  Hooks.on("getFolderContextOptions", (app: any, entries: any[]) => {
    const pack = app?.collection;
    if (bookOf(pack)?.role !== "actors") return;
    const isGM = () => !!game.user?.isGM;
    const run =
      (action: (book: Book, chapter: string) => Promise<void>) =>
      (target: HTMLElement) =>
        guarded(async () => {
          const folder = await folderOf(target);
          const book = bookFromPack(pack);
          if (folder && book) await action(book, folder.name);
        });
    entries.push(
      menuEntry("Load chapter", "fa-download", isGM, run(syncBook)),
      menuEntry("Unload chapter", "fa-eraser", isGM, run(unloadBook)),
    );
  });
  // A book's pack in the Compendium sidebar.
  Hooks.on("getCompendiumContextOptions", (_app: any, entries: any[]) => {
    const packOf = (target: HTMLElement) =>
      game.packs?.get((target as HTMLElement).dataset.pack ?? "");
    const isBook = (target: HTMLElement) => {
      const role = bookOf(packOf(target))?.role;
      return !!game.user?.isGM && (role === "actors" || role === "items");
    };
    const run =
      (action: (book: Book) => Promise<void>) => (target: HTMLElement) =>
        guarded(async () => {
          const book = bookFromPack(packOf(target));
          if (book) await action(book);
        });
    entries.push(
      menuEntry(
        "Load all chapters",
        "fa-download",
        isBook,
        run((b) => syncBook(b, null)),
      ),
      menuEntry(
        "Unload all chapters",
        "fa-eraser",
        isBook,
        run((b) => unloadBook(b, null)),
      ),
      menuEntry(
        "Update loaded chapters",
        "fa-arrows-rotate",
        isBook,
        run((b) => syncBook(b, null, { create: false })),
      ),
    );
  });
}
