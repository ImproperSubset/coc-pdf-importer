# coc-pdf-importer (ImproperSubset fork)

A Foundry VTT module that imports actors and items from Chaosium Call of Cthulhu
PDFs into the CoC7 system. This clone is the fork `ImproperSubset/coc-pdf-importer`
of `dgladkov/coc-pdf-importer`. `README.md` describes the module, its scripts and
its architecture; this file holds what a session needs beyond it.

## Working rules

- Never contact the upstream repo (`dgladkov/coc-pdf-importer`): no issues, PRs,
  comments or pushes without the operator's explicit permission. The `upstream`
  remote's push URL is `DISABLED`; `gh` defaults to the fork. Pass
  `--repo ImproperSubset/coc-pdf-importer` on every `gh` write.
- Commit and push straight to `main` on the fork. No PRs, no feature branches.
- No CI workflow. Never publish to the Foundry VTT package listing.
- Cut a release only when the operator asks for one.
- Do only what was asked; raise extras, alternatives and suggestions as
  questions first. Give a short plan before multi-step work.
- No attribution trailers on commits.
- Book content: fixture PDFs, dumps (`out/`) and golden snapshots (`golden/`)
  never enter git. Tests use made-up names and text. Comments, docs and commit
  messages may name Chaosium characters, creatures, places, items and chapters
  (the Fan Material Policy allows names, marked as Chaosium's), but never quote
  book prose, stat lines, rules text or bibliographic lines: write made-up text
  with the same structure instead.
- Verify claims about Foundry and CoC7 against their sources (Foundry API docs
  at `https://foundryvtt.com/api/v14/`, the CoC7 clone at `~/git/CoC7-FoundryVTT`,
  read-only) before relying on them. Target Foundry v13 and v14.

## Releasing

- Versions are `<upstream version>.hh.<n>`: the upstream release the code is
  based on, then this fork's release count on that base, from 1 (`1.1.2.hh.1`).
  Dots, not hyphens: Foundry's `isNewerVersion` compares period-separated parts.
- `npm run release` (or `printf '<version>\ny\n' | npm run release`) writes the
  version and the fork's `download` URL into `module.json`, `package.json` and
  `package-lock.json` and commits `Release <version>`. Pushing it runs
  `.github/workflows/release.yml`, which tags the release commit, builds
  `module.zip` and attaches it with `module.json`. Only `.hh.` versions release.
- A workflow run needs a push: after a release commit that didn't trigger one,
  push an empty commit.
- Install URL:
  `https://github.com/ImproperSubset/coc-pdf-importer/releases/latest/download/module.json`

## Verifying changes

- `npm test` (unit), `npm run type-check`, `npm run format:check`. Every
  behaviour change gets a unit test that fails on the previous code: check by
  restoring the old source file (`git show HEAD:<file> > <file>`), running the
  tests, and putting the new file back.
- Fixture PDFs (`fixtures/`), dumps (`out/`) and golden snapshots (`golden/`)
  are copyrighted and gitignored. The fixture here is
  `cha23125_-_the_two-headed_serpent_v1.2.pdf`.
- Parser changes: diff `npm run dump:json -- "<pdf>"` output against
  `golden/<name>.json` and confirm only the intended actors/items changed, then
  copy `out/<name>.json` into `golden/`. The golden test
  (`test/integration/golden.test.ts`) checks a fixed list of fixture names.
  The book-level integration tests are cancelled when their fixtures are
  absent; that is the harness, not a regression.
- To see what the importer does with a real book without Foundry, run
  `importCharacters()` on a dump's `actors` under a mock of `game`, `ui`,
  `Folder` and `Actor` (the shape `src/importer.test.ts` uses), and tally the
  weapons' backing skills or the folders actors land in. To test an unexported
  function, copy `src/*.ts` to a scratch directory, append an `export`, and
  symlink `node_modules` there.
- `npm run dump:text` writes the raw pdf.js text for reading a layout.
- Live checks need the operator's Foundry: give them console snippets. To pull
  actors for inspection: `foundry.utils.saveDataToFile(JSON.stringify(actors.map(a
=> a.toObject())), "application/json", "<file>.json")`.

## How it reads PDFs

pdf.js `getTextContent()` per page; each text item keeps only its string, font
name, height (font size) and end-of-line flag — not its x/y position, so reading
order is the PDF's content order. The actor parser merges items into font/height
runs, strips running headers and footers (non-body runs repeated on 8+ pages),
finds stat blocks by their `STR … CON` run and recovers names from heading
sizes. The item parsers read the whole document as one flattened string.
Book quirks are handled by general rules (commented with the book that
motivated them), never by per-book switches. `processPDF()` also reads the
contents page's sections and gives each actor its `page` and `chapter`.

## CoC7 and Foundry facts this code relies on

- `game.CoC7.cocid.fromCoCIDRegexBest` keeps only items flagged for the world's
  era (`worldEra` setting) or for no era. Core Content weapons are flagged
  `standard`/`modern`, so a Pulp world drops them; `loadCocidIndex` fills gaps
  from `fromCoCIDRegexAll({ era: false })`, preferring the world's language.
- NPC/creature sheets default to unlocked (`system.flags.locked: false`), and an
  unlocked sheet shows every inventory section; imported NPCs and creatures are
  created locked. The padlock is at the right of the Sanity Loss row.
- A creature sheet shows its descriptor from `system.infos.type` ("Type"); NPCs
  and investigators from `system.infos.occupation`.
- `foundry.utils.getRoute(path)` adds the server's route prefix; the pdf.js
  worker URL is built with it.
- `Document.create(data, { keepId: true })` creates under the given `_id`.
- Folder `sorting` is `"a"` (alphabetical) or `"m"` (manual, by `sort`).
- The system's creatures use a generic `Fighting (Fighting)` skill; an attack
  printed at a different value gets its own skill (the Chthonian's
  `Fighting (Crush)`).
- Actor CoC IDs have the form `a.creature.<name>` / `a.npc.<name>`; the
  importer sets CoC IDs on embedded items only, not on actors.

## Design decisions

- Re-import replaces a same-named actor/item under the same id (`src/replace.ts`):
  snapshot, delete, create with `keepId`, restore the snapshot if the create
  fails. Carried over: actor `img`, `prototypeToken`, `ownership`, `sort`; item
  `ownership`, `sort`. Same-named entries pair up in order; surplus old ones are
  deleted. Old actors are found anywhere under the book's Actor folder.
- A book's top-level Actor and Item folders are named for its title and flagged
  with the PDF's file name (`flags["coc-pdf-importer"].sourceFile`,
  `src/folders.ts`); a re-import finds them by that flag, else by title, else by
  the file name older imports used, and renames them to the current title.
- Actors go into chapter subfolders (`Chapter 1: Bolivia`, `Appendix A: …`) in
  printed order when the book's contents page lists chapters; otherwise flat.
  Items stay grouped by type (`Talents`, `Spells`, `Tomes`, `Artefacts`, …).
- A Pulp variant is named `<name> (Pulp)` and filed beside its standard actor.
  A variant an older import put in a separate `<folder> (Pulp)` folder is
  replaced under its id, and that folder is deleted once empty.
- Each printed attack stays its own named weapon, with its own damage. An
  unmatched weapon's skill comes from its category: a creature's melee attacks
  and manoeuvres use `Fighting (Fighting)`; a human's melee uses its weapon
  category (Sword, Axe, Spear, Whip, Garrote, Chainsaw, Flail) or Brawl;
  firearms use Handgun, Rifle/Shotgun, Submachine Gun, Machine Gun or Bow. The
  category skill's value is the actor's own skill, else the attack named for the
  category (`Fighting`, `Brawl`), else the most common value; a weapon printed
  at a different value gets a per-weapon skill. An attack printed
  `Fighting (X)` is a weapon named X. An attack with no value uses the category
  skill when present. Thrown weapons (`(thrown)`, `(Throw)`, names starting
  `Throw`) use Throw.
- Compendium weapon matching: a shotgun of no gauge is the 12-gauge (2B);
  10/16/20-gauge and 12-gauge sawed-off/pump/semi-auto map to their entries;
  a scalpel is a knife; names with laser/ray/beam/blaster are firearms (a
  staff takes Rifle/Shotgun). `Brawl` is not mapped to Core Content's `Punch`.

## Open ideas, not yet decided

- Capture the prose around stat blocks (creature descriptions, attack rules
  such as a Charge's knockdown) into Keeper notes; needs a boundary design.
- Give imported actors CoC IDs (`a.creature.<kebab-name>`); first check how
  CoC7 resolves an id shared with a Core Content creature.
- Harden `release.yml`: pin actions to commit SHAs, `persist-credentials: false`.
- PDF ligature splits ("Kornf ield", "unf inished", "Brief ing") are not joined
  generally.
- Spell lists can run on into the following sentence (the Gospel of Yig's).
- Remove the deprecated `includeCoAuthoredBy` from the operator's settings.
