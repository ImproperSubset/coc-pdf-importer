# Call of Cthulhu PDF Importer

## Overview

Import content from documents that use the standard Chaosium layout into the
[CoC7 system](https://github.com/Miskatonic-Investigative-Society/CoC7-FoundryVTT).
Requires Foundry VTT v13+.

Tested on the following documents:

- Masks of Nyarlathotep (campaign book and Keeper Reference Booklet)
- Escape from Innsmouth
- The Two-Headed Serpent (campaign book and Keeper Reference Booklet)
- Down Darker Trails (setting book and Keeper Reference Booklet)
- Pulp Cthulhu
- CoC7 Quick Start
- CoC7 Keeper Rulebook (Part 3: Scenarios)
- Gateways to Terror
- Doors to Darkness
- Dead Light and Other Dark Turns
- Does Love Forgive
- Mansions of Madness
- The Lightless Beacon

A single import reads a document once and creates both **actors** and, when the
document contains them, **items** (Pulp Cthulhu talents/archetypes, Chaosium
appendix Spells / Tomes / Artefacts, and Down Darker Trails' Old West
occupations, skills, weapons and spells). They go into two world compendiums
for the book, one for actors and one for items, filed in a compendium folder
named after the book's title; a re-import refreshes same-named entries in
place, keeping their ids, instead of duplicating them. Chapters are then
loaded into the world from the compendiums as they come into play (see
Usage). Each imported entry cites its
source — the book's title and the page it is printed on — at the top of its
Keeper notes, and in its `source` field where the CoC7 item type has one. The
title defaults to one derived from the file name and can be edited per file
in the import dialog. The book's compendiums and folders record the PDF's
file name, so a re-import of the same file finds them (and renames the
folders) whatever title is given.

### Actors

Import actors from the various flavors of the standard stat block layout —
"Name, age N, description" blocks, pre-generated investigator sheets, monster
"average / rolls" tables, multi-column tables for NPC groups, and the
two-column layouts of the newer books (Innsmouth). Each block yields
characteristics, derived stats, combat, skills, languages, spells, Sanity loss,
armor, and — for pre-gens — the background sections and gear. Names printed in
ALL CAPS are proper-cased on import, and a stat block never absorbs text from
beyond its own pages, so long scenario prose stays out of the sheets.

Where the CoC7 system has a matching compendium item, the importer adopts it so
imported content keeps the real CoCID, icon, and properties:

- **Weapons** are matched to the system's weapon compendium (core content
  preferred over the wiki fallback), with size/alias handling for common melee
  and firearm names and correct thrown-weapon profiles. The book's printed
  damage always wins, but impale/range/skill metadata comes from the match.
- **Skills** are created with their specialization filled in, so specialized and
  "(Any)" skills don't prompt the sheet for a name on import.

Note that the importer skips large portions of description prose — maneuver
mechanics, creature flavor, and the like — so consult the source documents when
running the game.

### Pulp variants

Some books (Masks of Nyarlathotep, Escape from Innsmouth, The Two-Headed
Serpent) print optional **Pulp Combat** and **Pulp Talents** sections inside a
stat block. The import dialog's Era (preset from the world's CoC7 era) picks
one: a classic import takes the standard profiles; a Pulp import takes, under
the same names, the pulp combat profiles in place of the standard ones (and,
where printed, the pulp HP and Luck), carries the talents as `talent` items,
and adds the Pulp-only stat blocks ("Pulp Option: Ghoul Pack", imported as
"Ghoul Pack"). Re-importing in the other era replaces each actor under its
id. An existing
talent of the same name in the world is used (icon, category and CoCID kept)
but reads with the book's own description; otherwise an inline talent with
that description is created.

### Pulp Talents & Archetypes

The 40 player talents and 22 archetypes from the Pulp Cthulhu rulebook are
parsed and imported as CoC7 `talent` and `archetype` items. Archetypes carry
their core characteristic(s), bonus points, suggested occupations/traits, talent
count, and a resolved skill list (each skill mapped to its CoCID itemKey).

In the item compendium, items are filed in one folder per type (`Talents`,
`Archetypes`, `Spells`, `Tomes`, `Artefacts`, …). When the book has a contents
page listing its chapters ("CHAPTER 1: BOLIVIA 18"), each actor is filed in
the actor compendium in a folder for the chapter its stat block is printed in
(`Chapter 1: Bolivia`, …, `Appendix A: …`), in the book's order, and each item
belongs to the chapter it is printed in. Loaded into the world, they keep this
structure under a `<book title>` **Actor** folder and a same-named **Item**
folder.

### Down Darker Trails

The Old West sourcebook's reference chapters are imported as items: the 26
occupations, its altered and new skills, the firearm and melee weapon tables,
and the shamanic / folk magic spells.

### Spells, Tomes & Artefacts

Books that include Chaosium appendix sections (e.g. Masks of Nyarlathotep
Appendices B–D), or that print appendix-style entries inline in their chapters
(Escape from Innsmouth), yield world items:

- **Spells** — name, casting time, legacy cost fields (MP / SAN / POW / HP), and
  description body. Automated `costList` steps are not generated.
- **Tomes** — bibliographic metadata, Sanity / Mythos stats, study time; Link,
  Relevance, and spell lists go in the keeper notes (no spell item linking).
- **Artefacts** — full text in keeper notes; Foundry `weapon` when the body
  looks combat-capable, otherwise generic `item`. Nested under region folders
  when the appendix prints chapter banners (`Artefacts/Peru/…`).
- **Tomes** — also nest under region folders when a banner is present
  (`Tomes/Egypt/…`).

## Usage

1. Install the module from

   ```console
   https://github.com/ImproperSubset/coc-pdf-importer/releases/latest/download/module.json
   ```

2. Go to Settings → Game Settings → Call of Cthulhu PDF Importer → Import button
3. Upload the document(s) and wait until the import is complete. The book's
   actors and items are now in its compendiums, under a compendium folder
   named after the book's title.
4. Load what you need into the world. In the actor compendium, right-click a
   chapter folder for **Load chapter** or **Unload chapter**; in the
   Compendium sidebar, right-click either of the book's compendiums for
   **Load all chapters**, **Unload all chapters** or **Update loaded
   chapters**. Loaded entries keep their compendium ids, so tokens placed in
   scenes find their actors again when a chapter is reloaded. Unloading keeps
   each actor's portrait, prototype token and ownership (and each item's
   ownership) in the compendium, and loading again restores them.
5. After a re-import of a corrected PDF, the importer offers to update the
   loaded chapters: the import's fixes are applied, changes made in play are
   kept, and anything both changed is shown for review (the world value is
   kept unless you pick the import's). What each loaded entry was loaded from
   is recorded in two compendiums in the book's **Import records** folder,
   removed when the book's last chapter is unloaded. Sheet settings (the lock,
   open panels) and a skill's improvement tick are never touched.

## Development

### Prerequisites

- **Node.js 22+** (developed on Node 26). TypeScript sources are run directly
  via `node --experimental-strip-types`, so there is **no separate transpile
  step** for tests or tooling.
- `npm install` to pull dependencies (`pdfjs-dist`, `math.sumprecise`, and the
  dev toolchain: `esbuild`, `typescript`, `prettier`, `@thednp/dommatrix`).
- **7-Zip** is required only for `npm run build:module` (the release zip): the
  `7z` CLI on Windows, `7zz` (p7zip) on Linux/macOS.

### How it works

Parsing is split from Foundry entirely: `process.ts`, `pulp.ts`, `appendix.ts`
and `oldwest.ts` never touch the Foundry API, which is what makes them directly
testable.

1. **Extraction & parsing** — `processPDF()` (in `process.ts`) uses `pdfjs-dist`
   to read every page's text runs **once**, keeping each run's font size. From
   that shared representation it runs independent parsers and returns
   `{ actors, items }`:
   - the **actor parser** strips repeating page furniture, finds stat-block
     anchors (the `STR … CON` run), recovers each block's name/age/description
     (using font size and page boundaries to separate a heading from body
     prose), and parses the stats into `CocCharacter`s. Multi-column group
     tables expand to one character per column.
   - the **item parsers** (`pulp.ts`, `appendix.ts`, `oldwest.ts`) read pulp
     talent/archetype tables, Chaosium appendix Spells/Tomes/Artefacts, and the
     Down Darker Trails reference chapters into internal item structures. Each
     is guarded by its book's own section markers, so a document without those
     sections yields no items. Source-faithful data stays unresolved (e.g. skill
     _names_, not CoCIDs).
2. **Import** — `importDocument()` (in `document.ts`) creates the documents
   in the book's actor and item compendiums (`packs.ts`; `target.ts` lets the
   same code fill the world or a pack):
   - actors via `importCharacters()` (`importer.ts`), which maps each
     `CocCharacter` onto CoC7 actor system data and embedded items (skills,
     weapons + backing skills, spells; their ids are stable, `ids.ts`), in a
     chapter folder when `processPDF()` found the book's chapters
     (`parseBookSections()`: the contents page's entries, mapped to PDF pages
     through the page numbers in the running headers).
   - items via `createPulpItems()` (`document.ts`), which builds the Foundry
     documents (resolving pulp skill names to CoCID itemKeys here) and files
     them under typed folders.

   A re-import replaces same-named entries in each compendium instead of
   duplicating them (`replace.ts`): the old document is deleted and the new one
   created under the same id. If the create fails, the old document is
   restored. An entry new to a compendium takes the id of the same-named world
   document an earlier, straight-to-world import made.

3. **Load, unload and update** — `chapters.ts` copies a chapter's entries into
   the world under their compendium ids, saving each copy's base (what it was
   loaded from) in the book's base compendiums; an update compares base, world copy
   and compendium entry field by field (`merge.ts`) and asks the Keeper only
   about fields both play and the import changed.

### npm scripts

Copy `fvtt.config.example.js` → `fvtt.config.js` and set `userDataPath` to your
Foundry user data folder (e.g. `/Users/YOU/foundrydata`). Builds then land in
`Data/modules/coc-pdf-importer/` under that path.

- `npm run dev` — esbuild in watch mode → rebuilds the module into Foundry’s
  `Data/modules/coc-pdf-importer/` (or repo root if `userDataPath` is unset)
- `npm run build` — one-off production bundle to the same destination
  (`module.js` + source map + pdf.js worker + `module.json` / `lang` /
  `templates`)
- `npm run build:module` — **release** build → `build/module.zip` +
  `build/module.json` (requires 7-Zip)
- `npm run release` — interactive: shows the current version, asks for the new
  one, and commits the version bump (`module.json` + `package.json` +
  `package-lock.json`) as `Release <version>`; pushing `main` then lets the
  release workflow tag, build and publish it
- `npm run type-check` — `tsc --noEmit` over `src/`, `test/`, `tools/`
- `npm run format` / `npm run format:check` — Prettier over the repo
  (Handlebars templates excluded, see `.prettierignore`)
- `npm test` — unit tests (fast, fixture-free, CI)
- `npm run test:integration` — book-level tests + golden snapshots — **needs the
  fixtures**
- `npm run dump:json` — parse every fixture (or one: `-- "<file.pdf>"`) →
  `out/<name>.json` (each file holds `{ actors, items }`)
- `npm run dump:text` — dump raw pdf.js text of a fixture → `out/<name>.txt`
  (for debugging extraction)
- `npm run audit -- "<name>"` — list what the parser likely got wrong in
  `out/<name>.json` (unpunctuated notes, incomplete stat blocks, odd names,
  group tables, weapon skills after a mock import); with `fixtures/<name>.pdf`
  also the PDF's metadata, font table, contents-page sections, write-up
  headings no actor holds and glued group taglines (`tools/audit-checks.ts`)

### Testing

Three tiers:

- **Unit** (`src/*.test.ts` and `tools/*.test.ts`, run by `npm test`) — fast, self-contained checks:
  the parsers against synthetic stat-block / reference text, and the Foundry
  builders against a mock harness. These use generic placeholder names, no
  copyrighted text.
- **Integration** (`test/integration/process.integration.test.ts`) — parse the
  real PDFs and assert on specific characters. Requires the fixtures.
- **Golden snapshots** (`test/integration/golden.test.ts`) — re-parse each
  fixture and compare the full `{ actors, items }` output byte-for-byte against
  `golden/<name>.json`, plus an assertion that no actor falls back to an
  "Unknown" name. This is the backward-compatibility guard: refactor the parsers
  freely, then confirm the snapshots are unchanged. To accept an intentional
  output change, run `npm run dump:json` and copy `out/*.json` into `golden/`.

The PDFs and snapshots are copyrighted and gitignored; integration and golden
tests **skip** when they're absent. See `fixtures/README.md` for the setup.

### The `Math.sumPrecise` / `DOMMatrix` shims

pdf.js needs `Math.sumPrecise` (recent JS) and a DOM `DOMMatrix`, which are
missing in Node and in older browsers. They are installed in three contexts:

- **Node** (tests + tooling): `node-setup.ts`, loaded via `--import`.
- **Browser main thread**: `import "math.sumprecise/auto"` at the top of
  `index.ts`, bundled into `module.js`.
- **Browser pdf.js worker**: `tools/copy-worker.js` prepends the shim to
  `pdf.worker.min.mjs` when it's copied into a build.

Without the worker shim, text extraction silently truncates glyph runs.

### Building for release

`npm run build:module` produces two artifacts in `build/`:

- `module.zip` — the installable module, packed with 7-Zip at ultra compression.
  It contains `module.json`, `module.js` (+ source map), the shimmed
  `pdf.worker.min.mjs`, and the `lang/` and `templates/` folders.
- `module.json` — a copy of the manifest served next to the zip, so a release's
  manifest URL can point at it while the download URL points at `module.zip`.

7-Zip must be installed (`7z` or `7zz` on PATH).

### Releasing

Versions are `<upstream>.hh.<n>`: the upstream
([dgladkov/coc-pdf-importer](https://github.com/dgladkov/coc-pdf-importer))
version the code is based on, then this fork's release count on that base,
starting at 1 (`1.1.2.hh.1`, `1.1.2.hh.2`, …). A push whose `module.json`
carries a bare upstream version never cuts a release.

Pushing a `Release <version>` commit to `main` (see `npm run release`) runs the
release workflow, which tags the version, builds the module, and creates the
GitHub release with `module.zip` and `module.json` attached. It does not publish to the Foundry VTT
package listing.
