// The top-level folder a book's actors or items are imported into. It is named
// for the book's title and carries the source PDF's file name in a flag, so a
// re-import of the same file finds it whatever it is called now.

// Foundry globals (game, Folder) are declared in ./foundry.d.ts.

const FLAG_SCOPE = "coc-pdf-importer";

const isTopLevel = (f: FoundryFolder) =>
  ((f.folder as any)?.id ?? f.folder ?? null) === null;

// Find the book's top-level folder of `type`, in order: the one flagged with
// `sourceFile`; one named `title`; one named `legacyName` (how imports were
// named before titles). A found folder is renamed to `title` and flagged;
// otherwise one is created.
export async function ensureBookFolder(
  type: "Actor" | "Item",
  title: string,
  sourceFile: string,
  legacyName: string = sourceFile,
): Promise<FoundryFolder | null> {
  const top = (test: (f: FoundryFolder) => boolean) =>
    game.folders?.find((f) => f.type === type && isTopLevel(f) && test(f));
  const flag = { [FLAG_SCOPE]: { sourceFile } };
  const found =
    top((f) => (f.flags as any)?.[FLAG_SCOPE]?.sourceFile === sourceFile) ??
    top((f) => f.name === title) ??
    top((f) => f.name === legacyName);
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
