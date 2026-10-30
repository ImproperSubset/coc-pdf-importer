// What a book's group tables' members are called, and the folder each table
// is filed in. With the corrections (errata.ts), the one per-book exception
// to general parsing rules: a table's title describes the whole table
// ("Average Grue Cultists (Fogland) Assorted Thugs") and its column labels
// are often numbers, so the member's name ("Grue Cultist 3") is the book's
// knowledge, not the parser's. A table the book's list does not name keeps
// the parser's names (title and label) and is filed under its title.
// Names and titles are Chaosium's.
import type { CocCharacter } from "./process.ts";

export interface TableNaming {
  /** The table's title as the parser reads it (`GroupTable.title`). */
  table: string;
  /** The folder its members are filed in: a short name. */
  folder: string;
  /** Each member's name, "{label}" standing for its column label. */
  member: string;
}

// By book: the product code that starts the PDF's file name.
export const TABLE_NAMES: Record<string, TableNaming[]> = {
  cha23153: [
    t("Kharisiri, Deathless Life-Suckers", "Kharisiri", "Kharisiri {label}"),
    t(
      "Carlyle Estate Guards",
      "Carlyle Estate Guards",
      "Carlyle Estate Guard {label}",
    ),
    t(
      "Carlyle Estate Guard Dogs, German Shepherds",
      "Carlyle Guard Dogs",
      "{label}",
    ),
    t(
      "Average Bloody Tongue Cultists (NYC) Assorted Thugs",
      "Bloody Tongue Cultists (NYC)",
      "Bloody Tongue Cultist {label}",
    ),
    t("Ciimba, Monstrously Strong Undead Horrors", "Ciimba", "Ciimba {label}"),
    t(
      "Average Townsfolk of Lesser Edale",
      "Lesser Edale Townsfolk",
      "Townsperson {label}",
    ),
    t(
      "Steadfast Constables, Trustworthy Officers",
      "Constables",
      "Constable {label}",
    ),
    t(
      "Average Brotherhood Cultists (England) Assorted Thugs",
      "Brotherhood Cultists (England)",
      "Brotherhood Cultist {label}",
    ),
    t(
      "Average Brotherhood Cultists (Egypt) Assorted Thugs",
      "Brotherhood Cultists (Egypt)",
      "Brotherhood Cultist {label}",
    ),
    t(
      "Additional Cultists of the Brotherhood (Resurrection Ceremony)",
      "Ceremony Cultists",
      "Ceremony Cultist {label}",
    ),
    t(
      "Million Favored Ones: Leeches, horrendous bloodsuckers",
      "Leeches",
      "Million Favored One ({label})",
    ),
    t(
      "Sample Children of the Sphinx",
      "Children of the Sphinx",
      "Child of the Sphinx ({label})",
    ),
    t(
      "Hirelings of Ahja Singh, Equal-Opportunity Thugs",
      "Ahja Singh's Hirelings",
      "Ahja Singh's Hireling ({label})",
    ),
    t(
      "Average Bloody Tongue Cultist (Kenya), Assorted Thugs",
      "Bloody Tongue Cultists (Kenya)",
      "Bloody Tongue Cultist {label}",
    ),
    t("Australian Rowdies, Drunken Agitants", "Australian Rowdies", "{label}"),
    t("Cultist Squad A", "Cultist Squad A", "Cultist {label}"),
    t("Cultist Squad B", "Cultist Squad B", "Cultist {label}"),
    t("Cultist Squad C", "Cultist Squad C", "Cultist {label}"),
    t("Cultist Squad D", "Cultist Squad D", "Cultist {label}"),
    t("Zombified Miners", "Zombified Miners", "Zombified Miner {label}"),
    t("Flying Polyps", "Flying Polyps", "Flying Polyp {label}"),
    t(
      "Nefarious Hirelings of Lin Yenyu",
      "Lin Yenyu's Hirelings",
      "Lin Yenyu's Hireling {label}",
    ),
    t(
      "Fighters for the New China to Come",
      "New China Fighters",
      "New China Fighter {label}",
    ),
    t(
      "Average Cultist of the Bloated Woman (China), Assorted Thugs",
      "Bloated Woman Cultists",
      "Bloated Woman Cultist {label}",
    ),
    t(
      "Crazed Crew of the Dark Mistress",
      "Dark Mistress Crew",
      "Dark Mistress Crewman {label}",
    ),
    t(
      "Villager Hybrids on Gray Dragon Island",
      "Villager Hybrids",
      "Villager Hybrid {label}",
    ),
    t(
      "Dire Deep Ones of Gray Dragon Island",
      "Dire Deep Ones",
      "Dire Deep One {label}",
    ),
  ],
};

function t(table: string, folder: string, member: string): TableNaming {
  return { table, folder, member };
}

// Name a book's group-table members and file each table under its folder
// name, per the book's list. Returns the entries that named no table.
export function applyTableNames(
  namings: TableNaming[],
  actors: CocCharacter[],
): TableNaming[] {
  const used = new Set<TableNaming>();
  for (const actor of actors) {
    const naming = namings.find((n) => n.table === actor.table?.title);
    if (!naming || !actor.table) continue;
    used.add(naming);
    actor.name = naming.member.replace("{label}", actor.table.label);
    actor.table.folder = naming.folder;
  }
  return namings.filter((n) => !used.has(n));
}
