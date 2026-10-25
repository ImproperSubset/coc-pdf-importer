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
  create(data: object, options?: { keepId?: boolean }): Promise<T>;
}

// Create a document, or replace `old` with it under the same id. Foundry cannot
// create a document with an id already in use, so the old one is deleted
// first; if the create then fails, the old one is restored as it was. `kept`
// names the fields of the old document that the Keeper owns rather than the
// book, which carry over to the replacement; `carry` works out further ones
// from the old document and the new data.
export async function createReplacing<T>(
  cls: DocumentClass<T>,
  old: ReplaceableDocument | null,
  data: Record<string, unknown>,
  kept: readonly string[],
  carry?: (old: any, data: Record<string, unknown>) => Record<string, unknown>,
): Promise<T> {
  if (!old) return cls.create(data);
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
      { keepId: true },
    );
  } catch (err) {
    try {
      await cls.create(snapshot, { keepId: true });
    } catch (restoreErr) {
      console.error(
        `coc-pdf-importer: failed to restore "${snapshot.name}" after a failed replace`,
        restoreErr,
      );
    }
    throw err;
  }
}

// Pair incoming names with the existing documents they replace. Each incoming
// name takes the next unclaimed existing document of that name, so two
// same-named incoming entries replace two old ones rather than each other.
// Old same-named documents beyond the incoming count are deleted now.
export async function claimReplaced<T extends ReplaceableDocument>(
  existing: T[],
  incomingNames: string[],
): Promise<{ take(name: string): T | null }> {
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
  for (const [name, list] of byName) {
    for (const extra of list.splice(wanted.get(name) ?? 0)) {
      try {
        await extra.delete();
      } catch (err) {
        console.error(
          `coc-pdf-importer: failed to remove duplicate "${extra.name}"`,
          err,
        );
      }
    }
  }
  return { take: (name) => byName.get(name)?.shift() ?? null };
}
