// The top-level folder a book's actors, items or packs are filed in. It is named
// for the book's title and carries the source PDF's file name in a flag, so a
// re-import of the same file finds it whatever it is called now.

// Foundry globals (game, Folder) are declared in ./foundry.d.ts.

const FLAG_SCOPE = "coc-pdf-importer";

const isTopLevel = (f: FoundryFolder) =>
  ((f.folder as any)?.id ?? f.folder ?? null) === null;

// The book's top-level folder of `type`, in order: the one flagged with
// `sourceFile`; one named `title`; one named `legacyName` (how imports were
// named before titles).
export function findBookFolder(
  type: "Actor" | "Item" | "Compendium",
  title: string,
  sourceFile: string,
  legacyName: string = sourceFile,
): FoundryFolder | null {
  const top = (test: (f: FoundryFolder) => boolean) =>
    game.folders?.find((f) => f.type === type && isTopLevel(f) && test(f));
  return (
    top((f) => (f.flags as any)?.[FLAG_SCOPE]?.sourceFile === sourceFile) ??
    top((f) => f.name === title) ??
    top((f) => f.name === legacyName) ??
    null
  );
}

// The book's existing top-level folders in the world (Actor and Item; made
// by Load), renamed to `title` and flagged: an import into the book's packs
// renames them with the packs' folder rather than at the next Load.
export async function renameBookFolders(
  title: string,
  sourceFile: string,
): Promise<void> {
  for (const type of ["Actor", "Item"] as const)
    if (findBookFolder(type, title, sourceFile))
      await ensureBookFolder(type, title, sourceFile);
}

// The book's top-level folder of `type` (see `findBookFolder`), renamed to
// `title` and flagged when found, else created.
export async function ensureBookFolder(
  type: "Actor" | "Item" | "Compendium",
  title: string,
  sourceFile: string,
  legacyName: string = sourceFile,
): Promise<FoundryFolder | null> {
  const flag = { [FLAG_SCOPE]: { sourceFile } };
  const found = findBookFolder(type, title, sourceFile, legacyName);
  if (found) {
    const flagged =
      (found.flags as any)?.[FLAG_SCOPE]?.sourceFile === sourceFile;
    if (found.name !== title || !flagged) {
      try {
        await found.update?.({ name: title, flags: flag });
      } catch (err) {
        console.error(
          `coc-pdf-importer: failed to rename "${found.name}"`,
          err,
        );
      }
    }
    return found;
  }
  try {
    return await Folder.create({ name: title, type, flags: flag });
  } catch {
    return null;
  }
}
