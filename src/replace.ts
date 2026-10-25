// Re-import support shared by the actor and item importers. A re-import
// replaces a same-named document in the target folder under the same id, so
// tokens, journal links and anything else that points at the old document by
// id resolve to the new one.

// Foundry globals (Actor, Item) are declared in ./foundry.d.ts.

interface ReplaceableDocument {
  name?: string;
  toObject(): any;
  delete(): Promise<unknown>;
}

interface DocumentClass<T> {
  create(data: object, options?: Record<string, unknown>): Promise<T>;
}

// Create a document, or replace `old` with it under the same id. Foundry cannot
// create a document with an id already in use, so the old one is deleted
// first; if the create then fails, the old one is restored as it was. `kept`
// names the fields of the old document that the Keeper owns rather than the
// book, which carry over to the replacement; `carry` works out further ones
// from the old document and the new data. `options` go with the create (a
// pack to create in); new data with an `_id` is created under that id.
export async function createReplacing<T>(
  cls: DocumentClass<T>,
  old: ReplaceableDocument | null,
  data: Record<string, unknown>,
  kept: readonly string[],
  carry?: (old: any, data: Record<string, unknown>) => Record<string, unknown>,
  options: Record<string, unknown> = {},
): Promise<T> {
  if (!old)
    return cls.create(data, data._id ? { ...options, keepId: true } : options);
  const snapshot = old.toObject();
  const carried = {
    ...Object.fromEntries(
      kept
        .filter((k) => snapshot[k] !== undefined)
        .map((k) => [k, snapshot[k]]),
    ),
    ...(carry ? carry(snapshot, data) : {}),
  };
  await old.delete();
  try {
    return await cls.create(
      { ...data, ...carried, _id: snapshot._id },
      { ...options, keepId: true },
    );
  } catch (err) {
    try {
      await cls.create(snapshot, { ...options, keepId: true });
    } catch (restoreErr) {
      console.error(
        `coc-pdf-importer: failed to restore "${snapshot.name}" after a failed replace`,
        restoreErr,
      );
    }
    throw err;
  }
}

// Pair incoming names with existing documents of the same name. Each
// incoming name takes the next unclaimed existing document of that name, so
// two same-named incoming entries pair with two old ones rather than one.
// Same-named documents beyond the incoming count are the surplus.
export function pairByName<T extends { name?: string }>(
  existing: T[],
  incomingNames: string[],
): { take(name: string): T | null; surplus: T[] } {
  const wanted = new Map<string, number>();
  for (const name of incomingNames)
    wanted.set(name, (wanted.get(name) ?? 0) + 1);
  const byName = new Map<string, T[]>();
  for (const doc of existing) {
    const name = doc.name ?? "";
    if (!wanted.has(name)) continue;
    const list = byName.get(name) ?? [];
    list.push(doc);
    byName.set(name, list);
  }
  const surplus: T[] = [];
  for (const [name, list] of byName)
    surplus.push(...list.splice(wanted.get(name) ?? 0));
  return { take: (name) => byName.get(name)?.shift() ?? null, surplus };
}

// The existing documents incoming names replace (see `pairByName`); the
// surplus same-named documents are deleted now.
export async function claimReplaced<T extends ReplaceableDocument>(
  existing: T[],
  incomingNames: string[],
): Promise<{ take(name: string): T | null }> {
  const pairs = pairByName(existing, incomingNames);
  for (const extra of pairs.surplus) {
    try {
      await extra.delete();
    } catch (err) {
      console.error(
        `coc-pdf-importer: failed to remove duplicate "${extra.name}"`,
        err,
      );
    }
  }
  return { take: pairs.take };
}
