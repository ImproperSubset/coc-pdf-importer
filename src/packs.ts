// A book's world compendium packs, flagged with the source PDF's file name and
// their role, and filed in a compendium folder named for the book. The actor
// and item packs hold the import; the hidden base packs hold, for each world
// copy, what was last loaded or applied to it.

// Foundry globals (game, foundry) are declared in ./foundry.d.ts.

import { ensureBookFolder } from "./folders.ts";

export const SCOPE = "coc-pdf-importer";

export type PackRole = "actors" | "items" | "actor-bases" | "item-bases";

const ROLES: Record<PackRole, { type: "Actor" | "Item"; label: string }> = {
  actors: { type: "Actor", label: "Actors" },
  items: { type: "Item", label: "Items" },
  "actor-bases": { type: "Actor", label: "Actor import records" },
  "item-bases": { type: "Item", label: "Item import records" },
};

export const BASE_ROLES: PackRole[] = ["actor-bases", "item-bases"];

// Ownership NONE for every role, the GM's included: the Compendium sidebar
// lists only packs a user can observe by role, while the GM still reads and
// writes them.
export const HIDDEN_OWNERSHIP = {
  PLAYER: "NONE",
  TRUSTED: "NONE",
  ASSISTANT: "NONE",
  GAMEMASTER: "NONE",
};

export interface BookFlag {
  sourceFile: string;
  role: PackRole;
}

// The book a pack belongs to, when it is one of this module's.
export function bookOf(pack: any): BookFlag | null {
  const flag = pack?.metadata?.flags?.[SCOPE];
  return pack?.metadata?.packageType === "world" &&
    typeof flag?.sourceFile === "string" &&
    flag.role in ROLES
    ? { sourceFile: flag.sourceFile, role: flag.role }
    : null;
}

export function bookPack(sourceFile: string, role: PackRole): any | null {
  return (
    game.packs?.find((p: any) => {
      const book = bookOf(p);
      return book?.sourceFile === sourceFile && book.role === role;
    }) ?? null
  );
}

// A pack name (letters, digits, hyphens) from the file name and role.
export function packName(sourceFile: string, role: PackRole): string {
  const slug = sourceFile
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "book"}-${role}`;
}

// The book's pack of `role`, made if missing, in the book's compendium folder.
// A pack the Keeper has locked stops the import.
export async function ensureBookPack(
  title: string,
  sourceFile: string,
  role: PackRole,
): Promise<any> {
  const { type, label } = ROLES[role];
  let pack = bookPack(sourceFile, role);
  if (!pack) {
    pack =
      await foundry.documents.collections.CompendiumCollection.createCompendium(
        {
          label: `${title} ${label}`,
          name: packName(sourceFile, role),
          type,
          flags: { [SCOPE]: { sourceFile, role } },
        },
      );
    if (BASE_ROLES.includes(role))
      await pack.configure({ ownership: HIDDEN_OWNERSHIP });
    // Chapter folders sit at the pack's top level, in printed order.
    if (role === "actors") {
      const modes = game.settings.get("core", "collectionSortingModes") ?? {};
      await game.settings.set("core", "collectionSortingModes", {
        ...modes,
        [pack.collection]: "m",
      });
    }
  }
  const folder = await ensureBookFolder("Compendium", title, sourceFile);
  if (folder && pack.folder?.id !== folder.id) await pack.setFolder(folder);
  if (pack.locked)
    throw new Error(
      `The compendium "${pack.title}" is locked; unlock it to import into it.`,
    );
  return pack;
}

// Make the book base packs visible (or hidden again) in the Compendium
// sidebar, for cleanup.
export async function showBasePacks(show: boolean): Promise<number> {
  const packs =
    game.packs?.filter((p: any) => {
      const role = bookOf(p)?.role;
      return role !== undefined && BASE_ROLES.includes(role);
    }) ?? [];
  for (const pack of packs)
    await pack.configure({ ownership: show ? undefined : HIDDEN_OWNERSHIP });
  return packs.length;
}
