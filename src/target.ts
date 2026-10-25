// Where an import puts its documents and folders: the world's sidebar, or a
// compendium pack. A pack holds one book, so its top level stands where the
// world uses the book's folder: a `null` root is the whole pack, but no folder
// at all in the world.

// Foundry globals (game, Folder) are declared in ./foundry.d.ts.

export interface Target {
  /** The pack's collection id, or null for the world. */
  pack: string | null;
  /** The document type the target holds ("Actor" or "Item"). */
  type: "Actor" | "Item";
  /** The target's folders of that type. */
  folders(): FoundryFolder[];
  /** The target's documents. */
  documents(): any[];
}

export function worldTarget(type: "Actor" | "Item"): Target {
  return {
    pack: null,
    type,
    folders: () => game.folders?.filter((f) => f.type === type) ?? [],
    documents: () =>
      (type === "Actor"
        ? game.actors?.filter(() => true)
        : game.items?.filter(() => true)) ?? [],
  };
}

// A pack's documents are loaded first, so `documents()` holds all of them.
export async function packTarget(pack: any): Promise<Target> {
  await pack.getDocuments();
  return {
    pack: pack.collection,
    type: pack.documentName,
    folders: () => [...pack.folders.contents],
    documents: () => [...pack.contents],
  };
}

// Options for creating a document or folder in the target.
export function createOptions(
  target: Target,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return target.pack ? { ...extra, pack: target.pack } : extra;
}

export function parentId(doc: { folder?: unknown }): string | null {
  return (doc.folder as any)?.id ?? (doc.folder as string | null) ?? null;
}

// Find (by name and parent) or create a folder in the target.
export async function ensureFolder(
  target: Target,
  name: string,
  parent: string | null,
  sort?: number,
): Promise<FoundryFolder | null> {
  const existing = target
    .folders()
    .find((f) => f.name === name && parentId(f) === parent);
  if (existing) return existing;
  try {
    return await Folder.create(
      {
        name,
        type: target.type,
        folder: parent,
        ...(sort !== undefined ? { sort } : {}),
      },
      createOptions(target),
    );
  } catch {
    return null;
  }
}

// Whether a folder id is `root` or one of its descendants; in a pack, every
// folder id (and the top level) is within a `null` root.
export function isWithin(
  target: Target,
  folderId: string | null | undefined,
  root: string | null,
): boolean {
  if (root === null) return target.pack !== null;
  let id = folderId ?? null;
  for (let depth = 0; id && depth < 8; depth++) {
    if (id === root) return true;
    const folder = target.folders().find((f) => f.id === id);
    id = folder ? parentId(folder) : null;
  }
  return false;
}

// The target's documents anywhere under `root`.
export function documentsUnder(target: Target, root: string | null): any[] {
  return target.documents().filter((d) => isWithin(target, parentId(d), root));
}

// Delete a folder and its subfolders when no document is left anywhere in
// them; subfolders go first, deepest first, so each deletion is of an empty
// folder.
export async function removeEmptyFolderTree(
  target: Target,
  root: FoundryFolder | null,
): Promise<void> {
  if (!root?.id) return;
  if (documentsUnder(target, root.id).length) return;
  const depth = (f: FoundryFolder): number => {
    let d = 0;
    for (
      let id: string | null = f.id ?? null;
      id && id !== root.id && d < 8;
      d++
    ) {
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
