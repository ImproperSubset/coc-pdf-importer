# Plan: Masks of Nyarlathotep, profiles, a format, and a rewrite

The working plan for this fork, worked through across sessions. Each phase
lists its steps, what proves it done, and what it waits on. Decisions record
the operator's choice and the reason, so they are not re-asked. Character,
creature and chapter names are Chaosium's; no book text is quoted here.

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

| Decision                                                                                                                                                                                            | Reason                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Get MoN to golden on the current TypeScript code first, then build profiles, the format and the rewrite.                                                                                            | The golden output is the oracle every later phase is checked against.                                                                |
| Book quirks may be specialized per publisher, line and book, as data (profiles). Code branches per book are avoided; a quirk no data can express gets a named hook.                                 | Chaosium typography alone varies widely, and the goal covers any publisher.                                                          |
| Chapter folders use numerals: "Chapter 2: America", "Prologue: Peru", "Appendix B: Spells".                                                                                                         | Saves horizontal space; matches the running headers and THS's folders.                                                               |
| One era per import: classic or Pulp, from the world's CoC7 era (`pulp`, `modernPulp`, `downDarkerTrailsPulp` are Pulp), with an override in the dialog. Actors keep plain names, no "(Pulp)" twins. | A campaign is one or the other.                                                                                                      |
| Pulp-only stat blocks (MoN's "Pulp Option: Ghoul Pack") import into Pulp worlds only, with a pointer in the notes of the section they belong to.                                                    | Optional material for the other flavour.                                                                                             |
| No automatic migration of old "(Pulp)" actors. The operator cleans up the Pulp campaign world by hand (about six THS actors).                                                                       | Few actors; not worth code.                                                                                                          |
| Group tables: a complete set, one actor per column (numbered or named), in the import's era.                                                                                                        | In play each column is a token.                                                                                                      |
| Portraits come from MoN's companion NPC portraits PDF, not the main book. Actor image and token start from the same full portrait; Tokenizer frames and masks the token.                            | The book's copies are ~130×175 px; the portraits PDF's are ~1080×1440 and unframed. The same image keeps reframing by hand possible. |
| Token frame and mask come from Tokenizer's own settings (frame on, mask on, circle mask, frame per disposition).                                                                                    | `autoToken` reads them; no per-call option exists.                                                                                   |
| A rewrite is judged by whether it can be verified, not by its size.                                                                                                                                 | The golden and baseline dumps detect regressions.                                                                                    |

## Phase 1: MoN to golden (current TypeScript)

Every step: a unit test in made-up text that fails on the old code, THS golden
unchanged, and the MoN baseline diff reviewed entry by entry. The MoN PDF is
symlinked into `fixtures/` (gitignored).

### 1.0 Audit tool

`tools/audit.ts`, run on any dump, prints the book's PDF metadata and font
table and lists:

- sections found (none is a finding)
- name-height write-up headings ("Name, age, descriptor" with a Link or
  Description bullet) held by no actor's notes
- notes and backgrounds ending without punctuation
- actors with no skills, no combat, a missing characteristic, or null HP
- attacks with no value or no damage; weapon names with odd characters
- per-weapon and category skills after a mock import (`importCharacters` under
  mocked `game`, `ui`, `Folder`, `Actor`), tallied by skill
- names with a glued tagline, odd spacing or case; duplicate names
- items with empty descriptions or merged names
- group tables and their column labels

### 1.1 Chapters

`parseBookSections` finds no MoN sections today. General rules:

- strip control characters (MoN ends each top-level contents entry with
  `\x08` before its page number) with whitespace, dots and `�`
- chapter numbers as digits or words (ONE to TWENTY), stored as numerals
- `PROLOGUE` and `EPILOGUE`, with or without `: TITLE`, beside `INTRODUCTION`
- `APPENDIX X: Title` in any case, with dot leaders
- skip an `APPENDICES` umbrella entry
- `INDEX` ends the last section without a folder (else Appendix D runs into
  the index for the appendix parsers)
- keep the guards: two chapter entries, a consistent page offset (MoN: 3,
  agreed by 657 of 669 pages)
- if a prose mention in the Introduction adds a stray entry, limit the scan to
  contents pages (dot leaders)

Expected: Introduction (holds the ten pre-generated investigators), Prologue:
Peru, Chapter 1 (no stat blocks), Chapters 2–7, Chapter 8, Appendices A–D.
Appendix item text may change because the parsers stop at section marks;
each change is reviewed.

### 1.2 Group tables

MoN has 27. Variants: numbered columns; named columns (the dogs Rex and
Zoltan, the Australian rowdies, Ahja Singh's hirelings, the sample Children of
the Sphinx, Leech/Host); lettered squads (Cultist Squad A1–D5). Fixes:

- a tagline after the name (same line or next) goes to the notes, not every
  column's name ("Kharisiri, Deathless Life-Suckers" gives "Kharisiri 1")
- heading words dropped or miscased ("Average", "(Nyc)" for NYC)
- footnotes restricting a weapon to some columns (the NYC cultists' handguns
  and throwing knives) give it only to those columns
- tables that come out with no combat and no skills (the Children of the
  Sphinx): find whether the parser fails or the book prints them elsewhere

### 1.3 One era per import

Importer, re-import pairing and packs; not the parser.

- read the world era; show and allow overriding the choice in the dialog
- Pulp import: the Pulp profile (Pulp Combat skills and weapons, talents);
  classic: the standard profile; Pulp boxes stay in the Keeper notes
- packs record their era; a re-import in the other era replaces by name under
  the same ids
- retire the "(Pulp)" naming and the old "\<folder> (Pulp)" folder code
- Pulp-only stat blocks per the decision above
- operator's THS Pulp world cleanup, after the release: re-import THS so the
  plain-name actors take the Pulp profile, repoint scene tokens placed from
  "(Pulp)" actors, then delete those actors (a console snippet can list the
  tokens and macros pointing at them)

### 1.4 The rest of the audit

- **Write-up name variants** (11 named NPCs miss their write-up): Lieutenant
  and Lt. (Poole), Captain only in the heading (Savoyard), middle names (both
  Cowleses, Huston, Hypatia Masters), a nickname only in the stat block (Jack
  "Brass" Brady), Mr. Lung and Mr. Lung Yun, an unaccented spelling (the
  Céspedes brothers' joint heading). General rules beside Doctor/Dr.
- **Notes leaks**: Jackson Elias's notes open with an unrelated Introduction
  passage; the Ghoul Pack takes the next section's Keeper note; the ten
  pre-gens' Pulp conversion box folds into Treasured Possession (make it its
  own Backstory section or a Keeper note).
- **Weapons**: `needle` in the firearm keywords (`src/importer.ts`) makes a
  knitting needle a firearm; a thrown weapon at its own value gets a
  `Fighting (…)` skill instead of a Throw variant (darts, African throwing
  knives); "Firearms (Rifl e)" (ligature split) becomes a melee weapon; Energy
  Blast (Black Pharaoh) has no value and no skill.
- **Names**: `Fergus "McChum " Chum`; "Ping Tun-Tun Fighting" as a weapon
  name; alternate forms named without their owner ("Mother Aspect", "Demon
  Form").
- **Items**: "Voorish Sign R'lyeh Text Commentaries" (a spell name merged into
  a tome's); Amulet of the Night Beasts and Taan's Ring have empty
  descriptions.
- **Spacing**: spaces before commas in notes ("Sánchez , 35"); THS has a few.
- **Open**: animals with no Sanity loss line (elephant, rhino, guard dogs)
  import as NPCs with Brawl, per the current rule. Operator to say whether they
  should be creatures.
- **Not yet checked**: spells the Appendix B parser misses.

### 1.5 Portraits and tokens

Spike first (below), then build.

- **Source**: `cha23153_-_masks_of_nyarlathotep_-_npc_portraits_v2.pdf`, 14
  pages, 9 captioned portraits a page on about 12 of them (roughly 100). Each
  painting is its own image object, with frame and name plate drawn over it
  separately; captions are real text below each image.
- **Offline**: pair images with captions by position, captions with actors by
  the write-up name rules; write `<Name>.webp` into the world's
  `assets/MoN/`. The audit lists captions matching no actor and named NPCs
  without a portrait. Files are book content: local only.
- **Importer** (on Load, on the world copy): set `img` and the token source to
  the portrait; set disposition from the Dramatis Personae heading the NPC is
  under (Allies and Independents, Adversaries, Minor NPCs) if the operator
  agrees; call Tokenizer's `autoToken` when Tokenizer is active, with a
  head-and-shoulders `tokenOffset`; skip actors without a portrait; if
  `autoToken` throws, carry on with the plain portrait.
- **Tokenizer facts** (`vtta-tokenizer` 5.0.3, source read at
  `github.com/MrPrimate/tokenizer`: `src/hooks.js`, `src/tokenizer/*.js`,
  `src/settings.js`): API at `game.modules.get("vtta-tokenizer").api` —
  `launch`, `tokenizeActor`, `tokenizeSceneToken`, `tokenizeDoc`,
  `updateSceneTokenImg`, `autoToken`; image classes not exported. `autoToken`
  starts from `prototypeToken.texture.src`, fits the image by its larger side
  and centres it, adds frame and mask per the world settings `add-frame-default`
  (default on), `add-mask-default` (default off), `default-mask-layer` (circle),
  frame by disposition (`default-frame-npc` hostile, `default-frame-neutral`),
  or tints. It uploads `<slug>.Token.webp` to the NPC upload directory
  (`targetFolder` overrides), sets `img` (same file, cache-busting query) and
  the token texture, ring settings, and updates placed tokens on the canvas.
  `tokenOffset: { position: {x, y} }` is a source-comment option; `scale`
  passes through to `addImageLayer` but is undocumented. Manifest: minimum and
  verified Foundry 13.
- Our carry-over keeps a Keeper-set image and token through re-import and
  Update, so hand fixes in Tokenizer's dialog survive. The dialog starts from
  the current token image, not the portrait.
- **Open**: token files in Tokenizer's folder or `assets/MoN/`; whether a
  module may upload into a world's `assets/` on v13/v14; whether the
  `TOKENS` folder of the operator's MoN Foundry pack
  (`~/Downloads/00-PACK-Masks of Nyarlathotep-Foundry`) already has these
  tokens.

#### Spike: what tokens would look like

Local Foundry (`~/git/foundry-dev`, runtimes 13.351, 14.358, 14.369) already
has CoC7 8.16, Core Content 1.3 (`cha-coc-fvtt-en-keeperitems`) and a `coc7e`
world on the 14.x runtimes.

1. Add to `~/git/foundry-dev/loadout.yaml` (cross-repo: operator approves or
   does it): `dev_modules: coc-pdf-importer: ~/git/coc-pdf-importer` and
   `modules: vtta-tokenizer: manifest:
https://github.com/MrPrimate/tokenizer/releases/latest/download/module.json`.
   `fvtt sync` symlinks both into every runtime, skips real directories, and
   probably also updates quench, Blades and mgt2e.
2. `npm run build` here (the symlink loads this tree's `module.js`).
3. New world `mon-test`: CoC7, 1920s era, Core Content, this module and
   Tokenizer; Tokenizer frame and mask on.
4. Extract portraits by caption into `Data/worlds/mon-test/assets/MoN/`.
5. Import MoN with the current module.
6. A snippet (or Playwright) sets portrait, token and disposition and calls
   `autoToken` with and without a `tokenOffset`; screenshot tokens on a scene
   and a few sheets.

Open: runtime (whichever matches the server), and who drives the browser
(Playwright needs the local admin password in `Config/admin.txt`, not read).

### 1.6 Test-world import and review

Import into the test world (local Foundry or a snapshot of the operator's
world). Check Core Content matching in a classic world, chapter folders,
Load/Unload, portraits and tokens. The operator's findings go back into 1.1–1.5.
When accepted: copy the MoN dump into `golden/`, add it to the golden test's
list.

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
  subheading, stat labels, sidebars), corrections (today's `src/errata.ts`,
  widened beyond spell names), aliases (proper nouns naming the same person or
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
- the unit tests (about 7,000 lines of made-up text) carried over as the
  behaviour spec

Rules: match the golden and baseline output exactly first, then fix as
reviewed diffs; small modules along the parser's stages; a prek gate on file
size. Today `src/process.ts` is 4,643 lines.

Open: whether the toolset grows here or in its own repo, with this one as its
CoC7 Foundry last mile.

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
  `out/`. The session's audit scripts were scratch files; 1.0 makes them a
  tool.
- Next step: 1.0, then 1.1.
