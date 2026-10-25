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
- Live checks need the operator's Foundry: give them console snippets (written
  out in full, in one place). To pull a book's actors for inspection, walk the
  book's folder and its chapter subfolders and save with
  `foundry.utils.saveDataToFile(JSON.stringify(actors.map((a) => a.toObject())),
"application/json", "<file>.json")`; the operator puts exports in
  `~/Downloads`. Single items come from Foundry's own Export Data.
- To compare against Core Content, ask for exports of the equivalent
  compendium items (`fvtt-Item-<name>.json`) and match field by field.

## How it reads PDFs

pdf.js `getTextContent()` per page; each text item keeps its string, font name,
height (font size), end-of-line flag, and x/y/width. Reading order is the PDF's
content order.

- The actor parser merges items into font/height runs, strips running headers
  and footers (non-body runs repeated on 8+ pages), finds stat blocks by their
  `STR … CON` run and recovers names from heading sizes. The item parsers read
  the whole document as one flattened string.
- Book quirks are handled by general rules (commented with the book that
  motivated them), never by per-book switches.
  The one per-book exception is content corrections (`src/errata.ts`, keyed
  by the product code that starts the file name): published errata, and
  readings of names a book misprints, each citing its source. They correct
  what a book says, never how the parser reads it; `processPDF` applies them
  when given the file name, and warns about one that applies nowhere.
- The books are untagged PDFs: pdf.js's `getMarkInfo()` and `getStructTree()`
  give nothing, and pdf.js has no paragraph detection. Paragraph starts are
  read from the layout (`paragraphStarts`: an indented body line, a line after
  a short sentence-ending line, a wider gap, or an in-column subheading a
  little larger than body text) and marked as blank lines in parsed
  descriptions, notes and backgrounds (`markParagraphs`); the importer renders
  them as `<p>` paragraphs. A column's left edge is the leftmost full line near
  it (bullet lines can be nearly full width too).
- Ligature-split words ("Kornf ield") are joined when the document prints the
  word whole elsewhere (`joinLigatureSplits`).
- `processPDF()` reads the contents page's sections ("CHAPTER 1: BOLIVIA 18";
  `parseBookSections`) and the printed-to-PDF page offset from the running
  headers' page numbers (`printedPageOffset`). Each actor gets its `page`,
  `printedPage` and `chapter`; each item gets its page by finding its own
  description text (the last page holding it, else its name off index pages;
  `locateItemPages`). The section starts are marked (`SECTION_MARK`) in the
  appendix parsers' text, so an appendix section ends at the next book section.
- A tome's spell list ends at its first full stop, or where a sentence starts
  without one (a capitalised word followed by an ordinary lowercase word,
  right after a spell name); the cut sentence goes to the description.

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
- A CoC ID is `<type>.<subtype>.<name>` (`a.creature.…`, `i.weapon.…`): the
  system reads the document type from the first segment, so a namespace goes
  inside the name part, as Core Content's do (`a.creature.cocqsr-rat-pack`).
- Core Content weapons store the skill as a CoC ID (`i.skill.firearms-handgun`),
  the range in yards ("15"; feet as "10/3"; thrown "@STR/5"), uses per round as
  normal/max ("1"/"3"), the magazine in `bullets`, and ranged/impale/burn/
  half-damage-bonus as `rngd`/`impl`/`burn`/`ahdb` flags (a whip is ranged).
- Core Content's "Death ray (prototype)" (`i.weapon.example-death-ray-prototype`)
  is an example item, not the Pulp Cthulhu Death Ray. That one (Pulp Cthulhu
  p. 88) is two-handed, Firearms (Rifle), 1D10+5 heat damage ignoring mundane
  armour, 1D8 shots, and gives no range; Two-Headed Serpent's Laser Staff
  repeats it, so it takes its range from the rifle equivalent.

## Design decisions

- Re-import replaces a same-named actor/item under the same id (`src/replace.ts`):
  snapshot, delete, create with `keepId`, restore the snapshot if the create
  fails. Carried over: actor `img`, `prototypeToken`, `ownership`, `sort`; item
  `ownership`, `sort`. An actor's portrait and token image carry over unless
  they are system default icons and the import brings art. Same-named entries
  pair up in order; surplus old ones are deleted. Old actors are found
  anywhere under the book's Actor folder.
- An imported creature the system also has (Core Content's Dhole, Ghoul,
  Lloigor; matched by name loosely, or as the system's name plus an "of …"
  qualifier, "Formless Spawn of Tsathoggua") takes that creature's portrait
  and token image (`src/creatureart.ts`); system creatures with default icons
  offer none. Nothing else comes from the match: the book's stat block stands.
- Every imported actor and item cites its source, "Source: <book title>, p.
  <printed page>" ("PDF page N" when the book prints no page numbers), as the
  first paragraph of its Keeper notes; talents, archetypes, occupations and
  spells also carry it in their `source` field (`src/citation.ts`). The book
  title comes from the import dialog's per-file title box, prefilled from the
  file name (product code, version and " - Call of Cthulhu" dropped).
- Imported actors get namespaced CoC IDs: `a.<type>.hh-<book>-<name>`
  (`a.creature.hh-the-two-headed-serpent-tyrannosaurus-rex`). Embedded skills,
  weapons and spells keep the system's own CoC IDs, which compendium matching
  relies on.
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
- The prose printed with a stat block goes to the Keeper notes: the intro
  between the heading and the stats (a creature's description, a recurring
  NPC's history, a group's "Use this profile for all …"), a starred value's
  footnote ("Move 12*: Swimming."), a "Keeper note:" in the block, and the
  bulleted "Description / Traits / Roleplaying hooks / Likely to be found at"
  (as Backstory sections, for every actor, not only investigators). Each piece
  ends at its last full stop, which drops a trailing heading, caption or table
  header.
- An NPC's write-up in the chapter text (a heading at name height, "Abidin,"
  "29, local guide", then prose and bullets instead of STR) opens the Keeper
  notes of the actor it names, heading first. Names match exactly, with
  titles in either form ("Doctor"/"Dr.") and with or without a parenthetical
  ("(Zyneste)"); a heading may name several ("Mortimer Allen (32) and Lloyd
  Allen (10), …"), follow a same-height caption ("Handout: Calcutta 1"), or
  be a bare group name with no comma ("Bolivian Soldiers"). It ends at the
  next heading or at a repeated section title inside the page's body text
  ("THE SETTING", stripped as furniture; running headers sit outside the body
  and don't count); portrait captions inside it are skipped. One broken off
  mid-sentence by a sidebar resumes at the first body line, on that page or
  the next, that starts in lowercase after a finished sentence; one that
  lacks its Roleplaying hook resumes at the first NPC bullet it lacks, within
  three pages and before the next name-height heading (a sidebar or a
  full-page diagram between). Prose that runs into STR is the block's own
  intro, and a write-up the notes already hold is dropped. Write-ups for
  people without a stat block, and topic sections ("The Inner Night's
  Involvement"), are not imported.
- An attack rule printed between "Attacks per round" and the attack rows
  ("Bite: …", "Pin down: …", "Fighting attacks: …") goes, every one, to the
  Keeper notes, and closes the description of the attack it names (by name
  without parentheticals; "Fighting (Bite)" is Bite; else the one label
  ending in the name, "Toxic bite" for Bite). A label follows a sentence end
  or leftover page furniture; a rule ends at its last full stop.
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
- An artefact counts as a weapon only when its text names the combat skill
  that uses it, calls it a throwing weapon, or has it deal damage or make
  attacks. Its stats (skill, damage, range, uses per round, shots, impale,
  burn, damage bonus) are read from its text; a compendium weapon for the same
  skill (`EQUIVALENT_WEAPONS` in `src/document.ts`) supplies only what the text
  leaves out (range, uses per round, damage-bonus handling; a knife's damage
  for "throwing daggers"); a weapon with no damage takes no damage bonus.
  Skills are stored as CoC IDs, as the system's weapons store them. Every
  artefact weapon keeps "special" set: its effects are in its notes.
- A re-import that changes an entry's document type (an artefact that stops
  counting as a weapon) recreates it with a new id; same-type replacements
  keep theirs.
- Spells store their costs as a cost list, as Core Content's do: a caster
  cost per deductible cost (number or dice), the printed Cost line as
  information when any part isn't deductible ("4+", "per round", "all
  remaining"), and a dice casting time as a rolled variable (`@rounds`). The
  legacy cost fields stay empty then; the sheet's Details tab shows only the
  cost list and the spell types, which come from the name (Contact, Summon,
  Bind, Call, Dismiss, Gate).
- A printed spell name is matched to the book's own spells first, then the
  system's (`src/spellmatch.ts`). Names match loosely: case, punctuation, a
  stray split letter ("Memor y"), doubled letters and plurals aside, without a
  trailing parenthetical ("Contact Yig" is "Contact Yig (Variant)"), without
  "Deity:" ("Contact Deity: Yig"), or by a Core alternative name. A name two
  spells answer to matches neither.
- A tome's Spells tab holds the spells its printed list names: the book's own
  spell as an embedded copy (of the created item, under its id), else a system
  spell by CoC ID. The Keeper notes' "Spells:" line stays as printed.
- A corrected spell name takes the corrected name in the actor's or tome's
  spell list, and its Keeper notes carry an "Errata:" line naming what was
  printed and the source.
- An actor's spell is a copy of the matched spell under that spell's name, so
  its CoC ID (which follows the name) is the system's; an unmatched one is a
  bare spell under the printed name.
- Compendium weapon matching: a shotgun of no gauge is the 12-gauge (2B);
  10/16/20-gauge and 12-gauge sawed-off/pump/semi-auto map to their entries;
  a scalpel is a knife; names with laser/ray/beam/blaster are firearms (a
  staff takes Rifle/Shotgun). `Brawl` is not mapped to Core Content's `Punch`.

## Open ideas, not yet decided

- Capture the prose around stat blocks (creature descriptions, attack rules
  such as a Charge's knockdown) into Keeper notes; needs a boundary design.
  Deferred by the operator to a later session.
- Chaosium's Fan Material Policy requires a fixed disclaimer on fan works and
  lists "downloadable apps and virtual tabletops" as excluded; neither upstream
  nor the fork addresses this. The operator's call.
- Remove the deprecated `includeCoAuthoredBy` from the operator's Claude Code
  settings (superseded by `attribution`).
