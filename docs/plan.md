# Plan: Masks of Nyarlathotep, profiles, a format, and a rewrite

The working plan for this fork, worked through across sessions. Each phase
lists its steps and how they are checked. Decisions record
the operator's choice and the reason, so they are not re-asked. Character,
creature and chapter names are Chaosium's; names and short phrases may be
quoted, never images or long runs of book text.

## Goal

Import any RPG book a Keeper owns into a VTT, starting with Chaosium's Call of
Cthulhu books into Foundry's CoC7 system. The near goal is Masks of
Nyarlathotep (MoN, `cha23153`) imported into a classic (1920s) campaign world
well enough to play from.

The long-term shape:

- **Offline** (no Foundry): read the PDF, apply book profiles, parse, audit,
  and write one file per book in a versioned format.
- **Last mile** (a thin Foundry module): read that file and do only what needs
  a world — compendium matching by CoC ID, the era filter, documents with
  stable ids, packs, folders, Load/Unload, Update's three-way merge, art.

## Terms

- **Baseline**: the parser's current output for a book, unreviewed. Proves a
  refactor or rewrite changed nothing it shouldn't. Every owned book can have
  one.
- **Golden**: output the operator has reviewed and accepted (`golden/`, checked
  by `test/integration/golden.test.ts`). Two-Headed Serpent (THS, `cha23125`) is
  golden. MoN is not: its dump in `out/` is a baseline until Phase 1 ends.

## Decisions

| Decision                                                                                                                                                                                                                                                                                                                                                                                                                      | Reason                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Get MoN to golden on the current TypeScript code first, then build profiles, the format and the rewrite.                                                                                                                                                                                                                                                                                                                      | The golden output is the oracle every later phase is checked against.                                                                |
| Book quirks may be specialized per publisher, line and book, as data (profiles). Code branches per book are avoided; a quirk no data can express gets a named hook.                                                                                                                                                                                                                                                           | Chaosium typography alone varies widely, and the goal covers any publisher.                                                          |
| Chapter folders use numerals: "Chapter 2: America", "Prologue: Peru", "Appendix B: Spells".                                                                                                                                                                                                                                                                                                                                   | Saves horizontal space; matches the running headers and THS's folders.                                                               |
| One era per import: classic or Pulp, preset from the world's CoC7 era (any era ending in "Pulp"), with an override in the dialog. Actors keep plain names, no "(Pulp)" twins.                                                                                                                                                                                                                                                 | A campaign is one or the other.                                                                                                      |
| Pulp-only stat blocks (MoN's "Pulp Option: Ghoul Pack") import in Pulp imports only, without the "Pulp Option:" label.                                                                                                                                                                                                                                                                                                        | Optional material for the other flavour.                                                                                             |
| No automatic migration of old "(Pulp)" actors. The operator cleans up the Pulp campaign world by hand (THS has five stat blocks with a Pulp section).                                                                                                                                                                                                                                                                         | Few actors; not worth code.                                                                                                          |
| Group tables: a complete set, one actor per column, in the import's era. Each table is a folder in its chapter; a per-book list (`src/tables.ts`, to move into Phase 2's profiles) gives the folder's short name and the members' names: a personal name alone ("Bernard"), else a short type and the column header ("Bloody Tongue Cultist 3", "Child of the Sphinx (Cheetah)"). The full title is the folder's description. | The title describes the whole table; the column header is the individual. In play each column is a token.                            |
| A re-import replaces the entries it brings and removes none (a classic re-import leaves the Pulp-only Ghoul Pack in the pack).                                                                                                                                                                                                                                                                                                | Removing an entry would lose the Keeper's settings on it.                                                                            |
| Order: world folders follow the book (chapters in printed order); inside a chapter, A–Z. A compendium's top-level order is per browser in Foundry and is left as it falls.                                                                                                                                                                                                                                                    | The world folders are what the Keeper works from.                                                                                    |
| Portraits come from MoN's companion NPC portraits PDF, not the main book. Actor image and token start from the same full portrait; Tokenizer frames and masks the token.                                                                                                                                                                                                                                                      | The book's copies are ~130×175 px; the portraits PDF's are ~1080×1440 and unframed. The same image keeps reframing by hand possible. |
| Token frame and mask come from Tokenizer's own settings: TheGreatNacho frame 13 trimmed so the ring reaches the token's edge, a full-disc mask, offset −20 (details in 1.5). No Foundry dynamic ring.                                                                                                                                                                                                                         | `autoToken` reads them; no per-call option exists. Ring close to the edge shows more of the portrait.                                |
| Pre-gens' "PULP ADJUSTMENTS" boxes: a Pulp import applies the definite parts (HP, skill changes with no condition, talents, a characteristic when only one is offered); both eras keep the whole box as its own Keeper note, out of Treasured Possession.                                                                                                                                                                     | The box is a template over the stat block; the note keeps the choices it leaves open ("DEX or APP", the archetype).                  |
| Git never holds book images or long runs of book text; names and short phrases are fine.                                                                                                                                                                                                                                                                                                                                      | Copyright.                                                                                                                           |
| Animals with no Sanity loss line (elephant, rhino, guard dogs) stay NPCs; a Sanity loss line alone makes a creature.                                                                                                                                                                                                                                                                                                          | Nothing in play depends on the actor type.                                                                                           |
| A rewrite is judged by whether it can be verified, not by its size.                                                                                                                                                                                                                                                                                                                                                           | The golden and baseline dumps detect regressions.                                                                                    |

## Phase 1: MoN to golden (current TypeScript)

Every step: a unit test in made-up text that fails on the old code, THS golden
unchanged, and the MoN baseline diff reviewed entry by entry. The MoN PDF is
symlinked into `fixtures/` (gitignored).

### 1.0 Audit tool (done)

`npm run audit -- "<name>"` (`tools/audit.ts`, checks in
`tools/audit-checks.ts`) reads `out/<name>.json` and, when present,
`fixtures/<name>.pdf`. It prints the PDF's metadata, font table and
contents-page sections, and lists: write-up headings no actor's notes hold
(with the actors near each name), group titles whose tagline the names run
in, unpunctuated notes and backgrounds, actors missing skills, combat,
characteristics or HP (a printed dash or "n/a" is not missing), attacks
with no value or damage, odd weapon and actor names, duplicate names
(within a table only), item problems, group tables as the parser records
them, and weapon skills after a mock classic import.

### 1.1 Chapters (done)

MoN reads Introduction, Prologue: Peru, Chapters 1–8 and Appendices A–D,
the Index ending Appendix D: chapter numbers in words, a prologue and
epilogue, appendices in any case, an "APPENDICES" entry skipped, a page
number split by a space. Chapters 1 and 8 hold no stat blocks; Appendix D
holds the Egyptian Cobra. Two item texts changed, both fixes (Ward of
Anubis no longer runs into the Tomes appendix; True Magick's spell list no
longer ends in "CHINA").

### 1.2 Group tables (done)

All 27 MoN tables: a tagline is the members' description; "(NYC)" keeps
its capitals; footnotes saying "only" give a weapon or a spell list to the
columns they name (NYC cultists, cultist squads); the Sample Children of
the Sphinx take the Children of the Sphinx's combat, armour and Sanity
loss, each with its own attack and damage; each table is a folder with the
names in `src/tables.ts` (see Decisions). Same names in two tables (NYC and
Kenya cultists, England and Egypt Brotherhood) are kept apart on re-import
by the table title, and their CoC IDs include the folder name.

### 1.3 One era per import (done)

The dialog's Era (Classic or Pulp) is preset from CoC7's `worldEra`. A Pulp
import takes each stat block's Pulp Combat, Pulp Talents, pulp HP and Luck
under its plain name, and the Pulp-only blocks; a classic import neither.
Each actor records its era in its `era` flag (a pack's metadata can't be
changed once made). The "(Pulp)" naming and the "\<folder> (Pulp)" folder
code are gone. The Pulp-only block's own source citation gives its page;
no other pointer is added.

Still to do, by the operator after the next release: clean up the THS Pulp
campaign world. Re-import THS as Pulp, so the plain-name entries take the
Pulp profile (Update then brings it to the loaded world copies); repoint
scene tokens placed from the five "(Pulp)" actors; then delete the "(Pulp)"
actors, world copies and pack entries both (nothing replaces or removes
them). A console snippet can list the tokens and macros pointing at them.

### 1.4 The rest of the audit

- **Write-up name variants** (10 actors miss their write-up): Lieutenant and
  Lt. (Poole), Captain only in the heading (Savoyard), middle names (both
  Cowleses, Huston), a middle name plus a form suffix (Hypatia Masters, whose
  stat block is "Hypatia Masters Aspect"), a nickname only in the stat block
  (Jack "Brass" Brady), Mr. Lung and Mr. Lung Yun, an unaccented spelling in a
  joint heading (Julio and Domingo Céspedes). The audit adds: Constable
  only in the heading (Hubert Tumwell); middle names only in the stat block
  (Lawrence and Eloise Vane); one heading for three sisters, each with her
  age in parentheses (Gertie, Shula and Janice Wycroft); a name that matches
  exactly yet got no write-up (Bill Buckley's Ghost: fixed with spacing,
  below); Wu (below).
  General rules beside Doctor/Dr.
- **Notes leaks**: Jackson Elias's notes open with an unrelated Introduction
  passage; the Ghoul Pack takes the next section's Keeper note; the ten
  pre-gens' "PULP ADJUSTMENTS" box folds into Treasured Possession (per the
  decision: its own Keeper note in both eras, its definite parts applied in a
  Pulp import).
- **Weapons**: `needle` in the firearm keywords (`src/importer.ts`) makes a
  knitting needle a firearm; a thrown weapon at its own value gets a
  `Fighting (…)` skill instead of a Throw variant (darts, African throwing
  knives; in a Pulp import, "Dart (thrown)" gets its own Fighting skill);
  "Firearms (Rifl e)" (ligature split) becomes a melee weapon;
  Energy Blast (Black Pharaoh) has no value and no skill. The audit adds:
  the Lightning gun gets its own `Firearms (Lightning gun)` skill (Kakakatak
  and the four squad members who carry one) instead of a Firearms category;
  manoeuvres ("Tongue Lash (mnvr)", "Tentacle Grab (mnvr)") get a skill of
  their own each.
- **Names**: "Ping Tun-Tun Fighting" as a weapon
  name; alternate forms named without their owner ("Mother Aspect", "Demon
  Form").
- **Items**: "Voorish Sign R'lyeh Text Commentaries" (a spell name merged into
  a tome's); Amulet of the Night Beasts and Taan's Ring have empty
  descriptions.
- **Attack footnotes**: a starred note under an attack list ("* When he
  is expecting trouble, de Mendoza carries his sword …", Brady's brass
  knuckles, Chu's silencer) is in no actor's notes; only a starred value's
  footnote before Combat is kept. Audit the class and keep them as Keeper
  notes.
- **Craig**: his write-up heading "PULP OPTION: DETECTIVE INSPECTOR JOHN
  CRAIG, 69, …" is attached to no actor, and so does not mark his stat block
  Pulp-only.
- **Wu**: "Wu, the Cat-Demon" imports as "Wu the Cat-Demon"; the descriptor
  should be the description, as for other single NPCs.
- **Printed "none"**: Fog-spawn prints its HP as "n/a" with a footnote; the
  parser drops it, so the dump can't tell "the book says none" from "the
  parser lost it" (a dash, as Bill Buckley's Ghost prints for STR and HP,
  is kept). Keep "n/a" values as printed, as dashes are.
- **Spacing (done)**: pdf.js prints a word in touching pieces where its font
  or colour changes ("Bill Buckley" "’s Ghost", a bold name before ", page
  9"); the parser joined them with a space. Pieces that touch with
  punctuation or two same-font letters between are joined without one
  (`markGlued`); a stat label touching its value ("Build:" "3") stays apart.
  Stray spaces in MoN went from 629 to 13 (the rest are ".38" and the like),
  THS's from 37 to 5, each as the book prints it. It also exposed a
  header-offset bug that cut Lin Yenyu's block short (her spells went to her
  hirelings, the hirelings' languages to Tun-Tun), now fixed.
- **Line-end compounds and dashes**: "wide- brimmed", "yard- diameter"
  (a hyphenated compound broken across lines keeps the break's space) and
  dashes read as "- " ("information- perhaps"); MoN 29, THS 11.
- **Sanity-loss leak**: Bill Buckley's Ghost's Sanity loss note runs on into
  the next section ("THE GREAT SANDY DESERT …", 3,700 characters); the only
  one so long in either book.
- **Not yet checked**: spells the Appendix B parser misses.

### 1.5 Portraits and tokens

The spike (below) is done; the build follows the plan here.

- **Source**: `cha23153_-_masks_of_nyarlathotep_-_npc_portraits_v2.pdf`, 14
  pages, 9 captioned portraits a page on about 12 of them (roughly 100). Each
  painting is its own image object, with frame and name plate drawn over it
  separately; captions are real text below each image. The spike's
  position-based pairing matched 82 portraits; captions in small capitals come
  out split ("E RICA C ARLYLE") and need joining, and the unmatched rest need
  a look.
- **Offline**: pair images with captions by position, captions with actors by
  the write-up name rules; write each portrait under a file-safe slug of the
  actor's name into the archive's `assets/MoN/`, and record the pairing
  (actor name → portrait file) in the book's data, so the importer never
  guesses from file names. The audit lists captions matching no actor and
  named NPCs without a portrait. Files are book content: local only.
- **Import (into the book's packs)**: for each actor with a recorded portrait
  whose file exists in the world (`worlds/<game.world.id>/assets/MoN/…`,
  checked with Foundry's file browser), set `img` and
  `prototypeToken.texture.src` to the portrait, and the token disposition from
  the Dramatis Personae heading the NPC is under (Allies and Independents,
  Adversaries, Minor NPCs) if the operator agrees. The pack entry carries the
  links, so the compendium shows portraits and Load copies them. Archive not
  installed, or no portrait: the actor keeps the default icons and the import
  says how many portraits it found. The existing carry-over still applies: a
  re-import keeps a Keeper-set image or token, and replaces only default
  icons.
- **Load (on the world copy)**: when Tokenizer is active and the token source
  is still the raw portrait, call `autoToken(actor)` with no options (the
  Tokenizer settings below do the framing). A token already rendered, or set
  by the Keeper, is left alone, so a reload does not re-render. Unload writes
  the world copy's token back into the pack entry (existing behaviour), so the
  rendered token survives Unload and Load. If `autoToken` throws or Tokenizer
  is off, the token stays the plain portrait.
- **Tokenizer facts** (`vtta-tokenizer` 5.0.3, source read at
  `github.com/MrPrimate/tokenizer`: `src/hooks.js`, `src/tokenizer/*.js`,
  `src/settings.js`): API at `game.modules.get("vtta-tokenizer").api` —
  `launch`, `tokenizeActor`, `tokenizeSceneToken`, `tokenizeDoc`,
  `updateSceneTokenImg`, `autoToken`; image classes not exported. `autoToken`
  starts from `prototypeToken.texture.src`, fits the image by its larger side
  (by its shorter side with `default-crop-image`) and centres it, shrinks it
  by `default-token-offset` when a frame or mask is on, adds frame and mask
  per the world settings `add-frame-default` (default on), `add-mask-default`
  (default off), `default-mask-layer` (default: a circle keeping only the
  middle two-thirds, sized for Foundry's ring), frame by disposition
  (`default-frame-npc` for hostile, `default-frame-neutral` for neutral and
  friendly), or tints; `default-color-layer` (default on) puts a white layer
  behind the image. It uploads `<slug>.Token.webp` to the NPC upload directory
  (`targetFolder` overrides), sets `img` (same file, cache-busting query) and
  the token texture, ring settings, and updates placed tokens on the canvas.
  `tokenOffset: { position: {x, y} }` is a source-comment option; `scale`
  passes through to `addImageLayer` but is undocumented. Manifest: minimum and
  verified Foundry 13.
- **Chosen token look** (spike on the local 14.369 `coc7e` world, Erica
  Carlyle): TheGreatNacho frame 13 (public domain), trimmed to the ring's
  outer edge so the ring fills the token, and with the faint white sheen
  inside the ring made fully transparent (it brightens and flattens the
  portrait); the mask is a full disc out to the ring's outer edge (a mask
  clips the frame too, so a smaller disc cuts the ring). For the spike they
  sit in the local runtime's `Data/tokenizer/frames/nacho-13-trimmed.webp`
  and `nacho-13-trimmed-mask.webp`; the build makes them and ships them in the
  install archive.
  Tokenizer settings: `add-frame-default` and `add-mask-default` on,
  `default-frame-npc` and `default-frame-neutral` the trimmed frame,
  `default-mask-layer` the trimmed mask, `default-crop-image` on,
  `default-color-layer` off, `default-token-offset` −20, no Foundry dynamic
  ring (`auto-apply-dynamic-token-ring` off,
  `force-disable-dynamic-token-ring` on). The importer then calls
  `autoToken(actor)` with no options; no per-token scale. Tokenizer's own
  `default-mask.png` is a ring, not a disc, and blanks the token; the
  undocumented `tokenOffset.scale` moved the portrait out of view.
- **Install archive**: the offline step writes one tar or zip per book that
  the operator unpacks inside `worlds/<world>/` on the server (the world's
  name is not known when it is built): `assets/MoN/<slug>.webp` (portraits)
  and `assets/tokenizer/nacho-13-trimmed.webp` and
  `nacho-13-trimmed-mask.webp` (frame and mask). The importer builds paths
  from `game.world.id` at run time. Tokenizer's settings live in the world's
  database, so they are set once by hand or by a snippet the archive
  carries; tokens are rendered on the server by `autoToken` at Load. The
  book's format file (Phase 3) can travel in the same archive.
- Our carry-over keeps a Keeper-set image and token through re-import and
  Update, so hand fixes in Tokenizer's dialog survive. The dialog starts from
  the current token image, not the portrait.
- **Open**: whether disposition comes from the Dramatis Personae heading;
  token files in Tokenizer's NPC folder (its default, `tokenizer/npc-images`
  at the Data root) or under the world (`targetFolder`); whether the `TOKENS`
  folder of the operator's MoN Foundry pack
  (`~/Downloads/00-PACK-Masks of Nyarlathotep-Foundry`) already has these
  tokens.

#### Spike (done): what tokens look like

Run on the local Foundry 14.369 (`~/git/foundry-dev`, latest stable 14.x),
which has CoC7 8.16, Core Content 1.3 (`cha-coc-fvtt-en-keeperitems`) and the
`coc7e` world. One portrait (Erica Carlyle) only; MoN itself was not imported.

- `foundry-dev/loadout.yaml` gained `coc-pdf-importer` (dev module, symlinked
  to this repo) and `vtta-tokenizer` (5.0.3); committed in foundry-dev as
  `dc75064`. `fvtt sync` linked both into every runtime.
- The admin password was unknown; `config/admin.txt` and the 14.369 copy were
  renamed to `admin.txt.bak`, so 14.369 has no admin password and `fvtt sync`
  no longer deploys one (the other runtimes keep the copies they have).
- Foundry must be launched outside Claude's sandbox: the sandbox kills a
  command's background processes when the command ends.
- `fvtt stop` and `fvtt restart` kill every process with a connection on the
  runtime's port, the operator's browser included (`stop_runtime` in
  `foundry-dev/bin/lib/process.sh` uses `lsof -ti :<port>`; matching
  `-sTCP:LISTEN` would fix it). Don't use them while a browser is connected;
  the fix is the operator's call.
- `npm run build` without `fvtt.config.js` writes to the repo root; its asset
  copy then fails on copying `lang/` onto itself and skips the PDF.js worker,
  while still reporting success. The worker was copied by hand. Fix: skip
  the copy when source and destination are the same.
- Result: the chosen token look above. Scene lighting (most likely) washed
  the test token out on the canvas; the token files themselves keep the portrait's
  contrast.

### 1.6 Test-world import and review

Machinery checked on the local 14.369 `coc7e` world with `fvtt eval`: a
Pulp import of MoN (366 actors, 76 items), table folders with their titles
as descriptions, Load chapter (Chapter 2: 55 actors under their pack ids,
the folder tree copied), Load chapter offered on chapter folders only, and
a classic re-import keeping all 366 ids and the loaded copies', and Unload
chapter (the 55 copies, their emptied folders and the base packs deleted;
the 366 pack entries kept). Found:

- the book title kept the file name's "v1.9 reduced file size" (fixed:
  `bookTitleFromFileName`); a pack's label keeps the title of its first
  import, so the test world's MoN packs keep the old one
- a compendium's top-level sort order is per browser (Foundry's
  `collectionSortingModes` setting is `scope: "client"`), so any other browser shows
  the chapter folders alphabetically (Appendix D first, Prologue last), THS
  included. Accepted by the operator: the order that matters is the world
  folders', which is world data and is book order.
- a classic re-import leaves the Pulp-only Ghoul Pack in the pack: a
  re-import replaces the entries it brings and removes none. Kept as is by
  the operator's decision.
- the world folders Load made kept the old title after a re-import renamed
  the pack folder (fixed: the import renames them too).

Still to do: import into the test world (local Foundry or a snapshot of the
operator's world) once 1.4 and 1.5 are done; check Core Content matching
in a classic world, portraits and tokens. The operator's findings go back
into 1.1–1.5. When accepted: copy the MoN dump into `golden/`, add it to
the golden test's list.

## Phase 2: Book profiles

- Layers: publisher → line or collection → book, each data, lower overriding
  higher.
- Matching: file-name pattern (product code), PDF metadata (Title, Author,
  Creator), font signature (body and heading families). Measured: both
  Chaosium books use ACaslonPro 9pt body and Voltaire headings; MoN's PDF has
  Title and Author, THS's none; pdf.js gives real font names once a page's
  operator list is loaded; headings and write-up names are a consistent red
  (`#890e11`), some labels white on shaded bars.
- Contents: typography (fonts, sizes, colours for body, name heading,
  subheading, stat labels, sidebars; text-layer spaces the page doesn't show:
  both Chaosium books set a near-zero-width space before a closing bracket,
  "roof )—see", "engulf )", which copies as a space but isn't visible), corrections (today's `src/errata.ts`,
  widened beyond spell names), group table names (today's `src/tables.ts`),
  aliases (proper nouns naming the same person or
  thing), structure (an explicit section list, group headings and taglines,
  things to skip).
- The parser reads the profile first and falls back to its inference.
- TypeScript data in `src/profiles/` (`chaosium.ts`, `cha23153.ts` extending
  it), recommended over JSON for type checking; operator to confirm.
- First pass: mechanism, corrections, aliases, structure, audit integration.
  Typography in its own pass once a second publisher's book shows what varies.
- Rewrite the CLAUDE.md lines on book quirks and errata in the same commit.

## Phase 3: A versioned format

- A shared envelope (book metadata, sections with pages, provenance,
  corrections, aliases) and a schema per game system (`coc7e` first).
- Model: Datasworn's approach (JSON Schema plus TypeScript types, versioned).
  Read the Dhole's House JSON that CoC7's actor importer reads
  (`coc7/manual/en/actor_importer.md` in the CoC7 clone) before designing the
  investigator part.
- The current parser writes it; the module imports through it. A newer module
  reads or clearly rejects an older file.
- Comparing old dumps with new ones needs a converter or a field-by-field
  comparison.

## Phase 4: Rewrite the offline side

Leaning to Python for the offline side (parser, profiles, audit, format tools)
with the Foundry module staying TypeScript and thin; operator to confirm. The
in-Foundry PDF import would go (run the parser, then import the file).

Prerequisites:

- baselines for every owned book (`fixtures/README.md` lists 16; owned ones
  include the Keeper Rulebook, Investigator Handbook, Pulp Cthulhu and the
  Quick-Start in `~/Documents/RPGs/CallOfCthulhu/`), so every code path —
  `oldwest.ts`, `pulp.ts` items, Innsmouth's Pulp HP/Luck, "Notable Folk"
  lists — has an oracle
- the unit and integration tests (about 11,200 lines, made-up text) carried
  over as the behaviour spec

Rules: match the golden and baseline output exactly first, then fix as
reviewed diffs; small modules along the parser's stages; a prek gate on file
size. Today `src/process.ts` is 4,900 lines.

Open: whether the toolset grows here or in its own repo, with this one as its
CoC7 Foundry last mile.

## Later (not scheduled)

- Skill checks printed in the book's text ("a Hard Spot Hidden roll"): record
  them as data so the Keeper can roll them from Foundry. Not started; CoC7's
  support for roll links not yet checked.
- Creatures fight as NPCs do: `Fighting (Brawl)` at their most common attack
  value, and a skill of its own for each attack printed at another value.
  Today they take the system's generic `Fighting (Fighting)`, as Core
  Content's creatures do, so the two would differ until the core creatures
  are imported too (below).
- Import the Keeper Rulebook's creatures, so all the creature content in a
  world follows this module's rules.

## Survey: extraction tools and prior art

Extraction, four MoN pages (contents, a sidebar page, the first Dramatis
Personae page, a group stat table):

| Tool                             | Result                                                                                                | Whole-book time      |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------- |
| pdf.js (current)                 | runs with fonts and positions; grouping is `process.ts`                                               | ~5 s, parse included |
| poppler `pdftotext -bbox-layout` | sidebar its own flow, headings own blocks; stat table shattered into 130 cells                        | 2.9 s                |
| pdfplumber                       | stat table recovered as rows; per-word font, size, colour                                             | not timed            |
| PyMuPDF                          | blocks with font, size, colour; table mostly right                                                    | 24.6 s               |
| Docling (ML)                     | headings, list items, footnotes, headers/footers labelled, reading order right; contents page mangled | 74 s for 4 pages     |
| pdfminer.six                     | layout analysis                                                                                       | 19.0 s               |

Conclusion: keep pdf.js; consider Docling as an optional hint pass after
timing a whole book; add colour to the Chaosium profile if pdf.js supplies it
(unverified).

Prior art: no general PDF-to-stat-block tool. Foundry importers are paste-text
and per system (5e, Daggerheart); Bindery does images only; PDF to Foundry
(Pathfinder 2e) reads owned PDFs of certain adventures and rejects modified
ones, which suggests per-book knowledge (inferred). CoC7 has a pasted-text
NPC importer and Dhole's House JSON for investigators. No cross-system schema
is widely used; Datasworn and 5etools' homebrew schema (read by Plutonium) are
system-specific models. `@foundryvtt/foundryvtt-cli` `compilePack` builds packs
from JSON (no running Foundry, per search results; README not checked).

## Resuming

- `fixtures/cha23153_-_masks_of_nyarlathotep_v1.9_reduced_file_size.pdf` is a
  symlink to `~/Documents/RPGs/CallOfCthulhu/Masks of Nyarlathotep/`; the
  Keeper Reference Booklet repeats the book and is not used.
- `npm run dump:json -- "<pdf>"` and `npm run dump:text -- "<pdf>"` write
  `out/`; `npm run audit -- "<name>"` audits a dump. `out/` holds current
  dumps of both books (THS's equals `golden/`).
- Local Foundry: 14.369 at `http://localhost:30003/` (no admin password),
  world `coc7e`; it holds the MoN packs from the live check, with nothing
  loaded, and the "Token spike" test actors. Drive it with `fvtt eval` (the
  `foundry-world` skill); run `npm run build` first, as the module is a
  symlink to this repo. The MoN PDF is staged in its `Data/assets/import/`.
- Released: `1.1.2.hh.18`. Everything from the audit tool (1.0) on is
  unreleased; the operator's campaign world has none of it.
- Pick up at 1.4, from its first item (write-up name variants), or with a
  release first if the operator wants one; the THS Pulp cleanup (1.3)
  follows that release.
