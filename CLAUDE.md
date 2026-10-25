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
- `npm run release` refuses a dirty tree. The sandbox leaves empty read-only
  placeholder files where it mounts `/dev/null` over protected paths
  (`.claude/settings.json`, `.mcp.json`, `.bashrc`, …); git ignores the root
  ones but reports `.claude/`. Run the release step outside the sandbox, and
  if `.claude/` still shows, list it in `.git/info/exclude` (never commit or
  delete there without the operator).
- After a release, the operator must reload the browser before re-importing:
  Foundry's client caches module code, so a stale `module.js` keeps running
  after the module updates. When a fix seems absent, check the running
  version in the console: `game.modules.get("coc-pdf-importer").version`.
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
  copy `out/<name>.json` into `golden/`. The argument is the file name alone
  (it resolves in `fixtures/`). The golden test
  (`test/integration/golden.test.ts`) checks a fixed list of fixture names.
  The book-level integration tests are cancelled when their fixtures are
  absent; that is the harness, not a regression.
- To see what the importer does with a real book without Foundry, run
  `importCharacters()` on a dump's `actors` under a mock of `game`, `ui`,
  `Folder` and `Actor` (the shape `src/importer.test.ts` uses), and tally the
  weapons' backing skills or the folders actors land in. To test an unexported
  function, copy `src/*.ts` to a scratch directory, append an `export`, and
  symlink `node_modules` there.
- `npm run dump:text` writes the raw pdf.js text for reading a layout. For
  font sizes and line structure, temporarily stash `parseActors`' chunks on
  `globalThis` and run `processPDF` from a scratch script; for positions, read
  the page with `pdfjs-dist/legacy/build/pdf.mjs` from a scratch directory
  with `node_modules` symlinked (`item.transform[4]`/`[5]` are x/y). Remove
  any debug line before committing: Prettier can split it past a one-line
  `sed`, so grep for it.
- Fix classes, not instances: when one case breaks (a write-up cut by a
  sidebar), audit the whole book for its kind before fixing — every name
  heading that matched no actor, every NPC bullet no actor holds, every note
  ending without punctuation — and fix what the audit finds together.
- A behaviour that needs Foundry's machinery to verify (an ApplicationV2
  action, a template) is checked against the API docs, then Foundry's client
  source for v13 and v14 (a local copy, located in `CLAUDE.local.md`) where
  the docs don't settle it; what neither settles is built in this module's
  own code rather than assumed of Foundry's.
- Live checks need the operator's Foundry: give them console snippets (written
  out in full, in one place). Write each to a scratch `.js` file, check it
  with `node --check`, and use plain `function`s with no `=>` and no `<`:
  snippets with arrow functions and angle brackets arrived broken in the
  operator's console twice (cause unconfirmed). Save results with
  `saveDataToFile` rather than printing them, and compare a live export with
  the golden dump field by field. To pull a book's actors for inspection, walk the
  book's folder and its chapter subfolders and save with
  `foundry.utils.saveDataToFile(JSON.stringify(actors.map(function (a) {
return a.toObject(); })), "application/json", "<file>.json")`; the operator puts exports in
  `~/Downloads`. Single items come from Foundry's own Export Data.
- To compare against Core Content, ask for exports of the equivalent
  compendium items (`fvtt-Item-<name>.json`) and match field by field. A
  whole pack comes from `pack.getDocuments()`, or its index with chosen
  fields from `pack.getIndex({ fields })`.

## How it reads PDFs

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
  them as `<p>` paragraphs. Each bullet ("• Traits: …") starts a paragraph,
  its label in bold. A column's left edge is the leftmost full line near
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
  created locked. Their Notes panel (`system.flags.panelNotes`, open by
  default) shows only the personal description, which the import leaves
  empty, so it is created closed. The padlock is at the right of the Sanity Loss row.
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
  anywhere in the book's actor pack (`src/target.ts`: the same code fills the
  world, under the book's folder, or a pack, whose top level is the book).
- An actor's embedded items take stable ids (`src/ids.ts`: parent id, type,
  name and occurrence), so a re-import's items match a loaded copy's by id;
  a custom weapon links its backing skill by that id.
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
- A book's top-level Actor, Item and Compendium folders are named for its
  title and flagged with the PDF's file name
  (`flags["coc-pdf-importer"].sourceFile`, `src/folders.ts`); they are found by
  that flag, else by title, else by the file name older imports used, and
  renamed to the current title. A world pack's label can't be changed (no
  client API), so the book's packs keep the title of their first import and
  the compendium folder carries the current one.
- Actors go into chapter folders (`Chapter 1: Bolivia`, `Appendix A: …`) in
  printed order when the book's contents page lists chapters; otherwise flat.
  Items stay grouped by type (`Talents`, `Spells`, `Tomes`, `Artefacts`, …).
- A Pulp variant is named `<name> (Pulp)` and filed beside its standard actor.
  A variant an older world import put in a separate `<folder> (Pulp)` folder
  is replaced under its id there (world target only), and that folder is
  deleted once empty.
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
  Keeper notes with its label in bold (marked `**Bite:**` in the parsed
  notes), and closes the description of the attack it names (by name
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

## Compendium import

Foundry's compendium article: world documents load for every user, pack data
only when needed, and storing unused documents in packs "greatly reduces the
time it takes to load your world". The goal is a world that holds only the
chapters in play, updated in place when a re-import fixes the book.

- The import writes one world compendium per book for actors and one for
  items, flagged as this module's in the pack metadata's `flags` (the v13
  and v14 servers clean `createCompendium`'s metadata with the pack schema,
  which has `flags`, and save it to `world.json`), in a compendium folder
  named for the book (`src/packs.ts`). Actors sit in chapter folders at the
  pack's top level (sorted manually, `core.collectionSortingModes`), items in
  type folders; each entry also carries its chapter in a flag. A re-import
  replaces by name within the pack, keeping ids; packs hold no play state. A
  locked pack stops the import with a message. The PDF dialog imports only
  into the packs.
- The first import into a book's packs gives an entry with nothing to
  replace the id of the same-named world document under the book's sidebar
  folder, so existing world documents become loaded copies (tokens, links
  and art stay attached).
- A chapter folder in the actor pack offers Load chapter and Unload chapter
  (`src/chapters.ts`);
  either of the book's packs offers Load all, Unload all and Update loaded,
  acting on both. Nothing is added to sidebar folders. Load finds or creates
  the book's sidebar folders (chapter folders in printed order, item type
  folders) and creates each missing actor and item in one call under its
  pack id (`fromCompendium` with `keepId`, which also sets
  `_stats.compendiumSource`); documents already loaded go through the update
  review. Unload
  deletes the world copies by id, then folders left empty, after a
  confirmation (play state is lost; placed tokens resolve again once the
  chapter is loaded, the ids being the same).
- An item's chapter is the section it is printed in (from its page), so
  appendix spells, tomes and artefacts load with their appendix.
- Menu entries come from the `getFolderContextOptions` and
  `getCompendiumContextOptions` hooks (both versions), shown to the GM on
  this module's packs only. Entries are `name`/`condition`/`callback(header)`
  in v13 and `label`/`visible`/`onClick(event, header)` in v14 (v14 still
  reads the old keys, with deprecation warnings), so the module builds the
  entry for the running generation.
- The base of each world copy (what was last loaded or applied) is kept in a
  pair of base packs per book, hidden by ownership NONE for every role: the
  Compendium sidebar lists only packs whose `visible` (role ownership, no GM
  exception) is at least OBSERVER, while the server's pack write check
  (`isOwner`) treats the GM as owner. Unload deletes the
  unloaded documents' bases with them, and a book's base packs are deleted
  once none of its documents is loaded (after Unload all, or the last
  chapter's Unload). The module setting Show import records makes the base
  packs visible again, for cleanup.
- Update compares base, world copy and pack, field by field (`src/merge.ts`;
  embedded items by id, arrays as one value; ids, folder, sort, ownership,
  `_stats`, effects and this module's flags left out): a field only the pack
  changed is applied, a field only
  play changed is kept, and a field both changed is listed in a review
  dialog (world value against the pack's, with the base), keeping the world
  value unless the Keeper picks the pack's. An embedded item added in play
  is kept; one removed in play stays removed unless the pack also changed
  it. The Keeper notes are one field (the Keeper doesn't edit them in
  play). Applying updates the world document in place and saves a new base:
  the pack entry, so a world value the Keeper kept is not asked about again
  until the pack changes it. Cancelling the review changes nothing. A PDF
  re-import offers the update when it finishes.
- Unlinked scene tokens keep their own changes apart from the actor, so an
  update reaches them except for an embedded item the token changed (CoC7's
  `coc-id-actor-update-items.js` updates token actors separately; this
  module doesn't); linked tokens are the world actor.
- A world copy with no base (imported straight from the PDF) counts as
  untouched when `_stats.modifiedTime` is within a few seconds of
  `_stats.createdTime` (the import's own follow-up updates move it by up to
  about 120 ms), its own data serving as the base; else every field that
  differs from the pack is listed as of unknown origin, its embedded items
  paired with the pack's by type and name (pack ids mapped to the world's,
  in the new base too).
- Foundry's own drag of a pack folder into the sidebar creates its folders
  and documents with `keepId`, and builds them again on a second drag (its
  already-present check compares the pack folder object with the world's),
  so it is no substitute for Load. Foundry's Import All on a pack makes new
  ids unless "keep ids" is ticked and saves no base, so its copies can't be
  updated; Load all is the whole-book import.
