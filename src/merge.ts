// The three-way comparison behind Update: a world copy against the pack entry
// it was loaded from and the base (what was last loaded or applied to it).
// Field by field, a change only the pack made is applied, a change only play
// made is kept, and a change both made is a conflict for the Keeper, who keeps
// the world value unless picking the pack's. Without a base, every difference
// is a conflict of unknown origin. Embedded items are compared by id; with no
// base, a world item pairs with the pack item of the same type and name.
// Pure: no Foundry calls, so the rules are unit-tested here.

export interface Conflict {
  /** The embedded item's world id, or null for the document itself. */
  itemId: string | null;
  /** The embedded item's name, for the review. */
  itemName: string | null;
  /** The field's path, or null for a whole embedded item (added or removed). */
  path: string | null;
  world: unknown;
  pack: unknown;
  /** Undefined when there is no base (unknown origin). */
  base?: unknown;
}

export interface ItemUpdate {
  _id: string;
  [path: string]: unknown;
}

export interface Merge {
  /** Fields of the document to set (dot paths), from the pack. */
  set: Record<string, unknown>;
  /** Fields of the document to remove (dot paths). */
  unset: string[];
  /** Embedded items to create, update (dot paths) and delete. */
  items: { create: any[]; update: ItemUpdate[]; delete: string[] };
  /** How many pack changes are applied and play changes kept. */
  applied: number;
  kept: number;
  conflicts: Conflict[];
  /** The pack entry's data with its embedded ids as the world's: the new
   * base once the merge is applied. */
  newBase: any;
}

// A choice for each conflict, by its index: true takes the pack's side.
export type Choices = boolean[];

// Fields Update leaves alone: identity and placement, Foundry's bookkeeping,
// ownership (the Keeper's), this module's flags, and active effects (the
// import makes none).
const IGNORED = new Set([
  "_id",
  "folder",
  "sort",
  "ownership",
  "_stats",
  "items",
  "effects",
  "flags.coc-pdf-importer",
]);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// Leaves of a document by dot path; arrays are single values.
export function flatten(
  data: Record<string, unknown>,
  prefix = "",
  out: Map<string, unknown> = new Map(),
): Map<string, unknown> {
  for (const [key, value] of Object.entries(data)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (IGNORED.has(path)) continue;
    if (isPlainObject(value) && Object.keys(value).length)
      flatten(value, path, out);
    else out.set(path, value);
  }
  return out;
}

export const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

type Side = "pack" | "play" | "both" | "none";

// Which side changed a value: `undefined` base means none is known.
function changedBy(
  base: unknown,
  hasBase: boolean,
  world: unknown,
  pack: unknown,
): Side {
  if (same(world, pack)) return "none";
  if (!hasBase) return "both";
  if (same(base, world)) return "pack";
  if (same(base, pack)) return "play";
  return "both";
}

interface FieldResult {
  set: Record<string, unknown>;
  unset: string[];
  applied: number;
  kept: number;
  conflicts: Conflict[];
}

function mergeFields(
  base: Record<string, unknown> | null,
  world: Record<string, unknown>,
  pack: Record<string, unknown>,
  item: { id: string; name: string } | null,
): FieldResult {
  const b = base ? flatten(base) : new Map<string, unknown>();
  const w = flatten(world);
  const p = flatten(pack);
  const out: FieldResult = {
    set: {},
    unset: [],
    applied: 0,
    kept: 0,
    conflicts: [],
  };
  for (const path of new Set([...b.keys(), ...w.keys(), ...p.keys()])) {
    const [bv, wv, pv] = [b.get(path), w.get(path), p.get(path)];
    switch (changedBy(bv, base !== null, wv, pv)) {
      case "pack":
        if (p.has(path)) out.set[path] = pv;
        else out.unset.push(path);
        out.applied++;
        break;
      case "play":
        out.kept++;
        break;
      case "both":
        out.conflicts.push({
          itemId: item?.id ?? null,
          itemName: item?.name ?? null,
          path,
          world: wv,
          pack: pv,
          ...(base ? { base: bv } : {}),
        });
        break;
    }
  }
  return out;
}

// Replace every string in `data` that is a key of `ids` with its value.
function remapIds(data: unknown, ids: Map<string, string>): unknown {
  if (typeof data === "string") return ids.get(data) ?? data;
  if (Array.isArray(data)) return data.map((v) => remapIds(v, ids));
  if (isPlainObject(data))
    return Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, remapIds(v, ids)]),
    );
  return data;
}

// With no base, pair pack items with world items of the same type and name,
// in order; pack ids map to the paired world ids.
function pairItems(world: any[], pack: any[]): Map<string, string> {
  const free = new Map<string, any[]>();
  for (const it of world) {
    const key = `${it.type}|${it.name}`;
    free.set(key, [...(free.get(key) ?? []), it]);
  }
  const ids = new Map<string, string>();
  for (const it of pack) {
    const match = free.get(`${it.type}|${it.name}`)?.shift();
    if (match && match._id !== it._id) ids.set(it._id, match._id);
  }
  return ids;
}

export function mergeDocument(
  base: any | null,
  world: any,
  packEntry: any,
): Merge {
  const worldItems: any[] = world.items ?? [];
  const ids = base
    ? new Map<string, string>()
    : pairItems(worldItems, packEntry.items ?? []);
  const pack = ids.size ? (remapIds(packEntry, ids) as any) : packEntry;
  const fields = mergeFields(base, world, pack, null);
  const merge: Merge = {
    set: fields.set,
    unset: fields.unset,
    items: { create: [], update: [], delete: [] },
    applied: fields.applied,
    kept: fields.kept,
    conflicts: fields.conflicts,
    newBase: pack,
  };

  const byId = (list: any[] | undefined) =>
    new Map((list ?? []).map((it: any) => [it._id as string, it]));
  const b = byId(base?.items);
  const w = byId(worldItems);
  const p = byId(pack.items);
  for (const id of new Set([...b.keys(), ...w.keys(), ...p.keys()])) {
    const [bi, wi, pi] = [b.get(id), w.get(id), p.get(id)];
    if (wi && pi) {
      const r = mergeFields(base ? (bi ?? null) : null, wi, pi, {
        id,
        name: wi.name,
      });
      if (Object.keys(r.set).length || r.unset.length)
        merge.items.update.push({
          _id: id,
          ...r.set,
          ...Object.fromEntries(r.unset.map((path) => [unsetKey(path), null])),
        });
      merge.applied += r.applied;
      merge.kept += r.kept;
      merge.conflicts.push(...r.conflicts);
      continue;
    }
    // On one side only: added or removed by the pack or by play.
    if (base) {
      if (!bi && pi) {
        merge.items.create.push(pi); // new in the pack
        merge.applied++;
      } else if (!bi && wi) {
        merge.kept++; // added in play
      } else if (bi && wi && !pi) {
        if (same(bi, wi)) {
          merge.items.delete.push(id); // the pack dropped it
          merge.applied++;
        } else merge.conflicts.push(itemConflict(id, wi, undefined, bi));
      } else if (bi && pi && !wi) {
        if (same(bi, pi))
          merge.kept++; // removed in play
        else merge.conflicts.push(itemConflict(id, undefined, pi, bi));
      }
    } else {
      merge.conflicts.push(itemConflict(id, wi, pi));
    }
  }
  return merge;
}

function itemConflict(id: string, world: any, pack: any, base?: any): Conflict {
  return {
    itemId: id,
    itemName: (world ?? pack)?.name ?? null,
    path: null,
    world,
    pack,
    ...(base !== undefined ? { base } : {}),
  };
}

// Foundry's update key that removes the last key of a dot path.
export function unsetKey(path: string): string {
  const i = path.lastIndexOf(".");
  return i < 0 ? `-=${path}` : `${path.slice(0, i)}.-=${path.slice(i + 1)}`;
}

// The merge with the Keeper's choices applied: a conflict whose choice is
// true takes the pack's side.
export function resolve(merge: Merge, choices: Choices): Merge {
  const out: Merge = {
    ...merge,
    set: { ...merge.set },
    unset: [...merge.unset],
    items: {
      create: [...merge.items.create],
      update: merge.items.update.map((u) => ({ ...u })),
      delete: [...merge.items.delete],
    },
  };
  merge.conflicts.forEach((c, i) => {
    if (!choices[i]) return;
    // A whole embedded item is on one side only.
    if (c.path === null) {
      if (c.pack === undefined) out.items.delete.push(c.itemId!);
      else out.items.create.push(c.pack);
      return;
    }
    const target = c.itemId
      ? (out.items.update.find((u) => u._id === c.itemId) ??
        (out.items.update.push({ _id: c.itemId }), out.items.update.at(-1)!))
      : null;
    if (c.pack === undefined) {
      if (target) target[unsetKey(c.path)] = null;
      else out.unset.push(c.path);
    } else if (target) target[c.path] = c.pack;
    else out.set[c.path] = c.pack;
  });
  return out;
}
