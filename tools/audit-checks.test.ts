// Unit tests for the audit's checks. All names and text are made up.
import { describe, test } from "node:test";
import assert from "node:assert";
import {
  actorNameIssues,
  attackGaps,
  fontTable,
  gluedTaglines,
  groupTables,
  incompleteActors,
  itemIssues,
  nameOddities,
  pageLines,
  textHeights,
  unheldWriteups,
  unpunctuated,
  weaponSkillTally,
  writeupHeadings,
} from "./audit-checks.ts";
import type { Line } from "./audit-checks.ts";
import type { CocCharacter, CombatEntry } from "../src/process.ts";
import { tome } from "../src/test-items.ts";

function actor(over: Partial<CocCharacter> = {}): CocCharacter {
  const c = (value: number) => ({ value, raw: String(value), marked: false });
  return {
    name: "Ada Lark",
    age: 40,
    description: "",
    characteristics: {
      STR: c(50),
      CON: c(50),
      SIZ: c(50),
      DEX: c(50),
      INT: c(50),
      APP: c(50),
      POW: c(50),
      EDU: c(50),
      HP: c(10),
    },
    derived: { DB: null, Build: null, Move: null, MP: null, Luck: null },
    attacksPerRound: null,
    combat: [attack("Brawl")],
    skills: { Spot: 40 },
    spells: [],
    sanityLoss: null,
    armor: null,
    background: [],
    items: [],
    notes: [],
    page: 5,
    ...over,
  };
}

function attack(name: string, over: Partial<CombatEntry> = {}): CombatEntry {
  return {
    name,
    value: 40,
    half: 20,
    fifth: 8,
    damage: "1D3",
    note: null,
    ...over,
  };
}

// Lines at body height 9 (most of them) and name height 11.
function line(text: string, height = 9, page = 1): Line {
  return { page, y: 0, font: "f1", height, text };
}
const filler = Array.from({ length: 6 }, () => line("Body text runs on."));

describe("pageLines", () => {
  test("joins items on one baseline and breaks at an end of line", () => {
    const item = (str: string, y: number, eol = false) => ({
      str,
      font: "f1",
      height: 9,
      y,
      eol,
    });
    const lines = pageLines(3, [
      item("Ada", 100),
      item("Lark,", 100, true),
      item("lamp keeper", 100),
      item("Next", 90),
    ]);
    assert.deepStrictEqual(
      lines.map((l) => [l.page, l.text]),
      [
        [3, "Ada Lark,"],
        [3, "lamp keeper"],
        [3, "Next"],
      ],
    );
  });
});

describe("textHeights", () => {
  test("name height skips page numbers and repeated furniture", () => {
    const lines = [
      ...filler,
      ...filler,
      ...filler,
      ...Array.from({ length: 9 }, () => line("FOGBOOK", 14)),
      ...Array.from({ length: 4 }, (_, i) => line(String(i + 10), 14)),
      line("Ada Lark, 40,", 11),
      line("Bo Reed, 30,", 11),
    ];
    assert.deepStrictEqual(textHeights(lines), { body: 9, name: 11 });
  });
});

describe("fontTable", () => {
  test("tallies by real font name and height, most text first", () => {
    const rows = fontTable(
      [line("abcd"), line("abcdefgh"), line("Heading", 11)],
      (id) => "Real-" + id,
    );
    assert.deepStrictEqual(
      rows.map((r) => [r.font, r.height, r.lines, r.chars]),
      [
        ["Real-f1", 9, 2, 12],
        ["Real-f1", 11, 1, 7],
      ],
    );
  });
});

describe("writeupHeadings and unheldWriteups", () => {
  const lines = [
    ...filler,
    line("Ada Lark , 40,", 11),
    line("lamp keeper", 11),
    line("She keeps the lamp."),
    line("• Description: tall and grey."),
    line("Bo Hope Reed, 30, ferryman", 11),
    line("• Link: rows the ferry."),
    line("Fog Harbour, at dusk", 11),
    line("No bullets follow this one."),
  ];

  test("finds name-height headings with a comma and a Link or Description bullet", () => {
    assert.deepStrictEqual(
      writeupHeadings(lines).map((h) => h.text),
      ["Ada Lark , 40, lamp keeper", "Bo Hope Reed, 30, ferryman"],
    );
  });

  test("keeps headings no actor's notes open with, with near names", () => {
    const actors = [
      actor({ notes: ["Ada Lark, 40, lamp keeper\n\nShe keeps the lamp."] }),
      actor({ name: "Bo Reed" }),
      actor({ name: "Cy Moss" }),
    ];
    assert.deepStrictEqual(unheldWriteups(writeupHeadings(lines), actors), [
      { page: 1, text: "Bo Hope Reed, 30, ferryman", candidates: ["Bo Reed"] },
    ]);
  });
});

describe("gluedTaglines", () => {
  test("reports a group title whose tagline the names run in", () => {
    const lines = [
      ...filler,
      line("GRUE, HUNGRY NIGHT-STALKERS", 17),
      line("FOG WARDENS, OF THE COAST", 17),
      line("Ssathl, as Ada Lark", 11),
    ];
    const actors = [
      actor({ name: "Grue Hungry Night-Stalkers 1" }),
      actor({ name: "Grue Hungry Night-Stalkers 2" }),
      actor({ name: "Fog Wardens 1" }),
      actor({ name: "Ssathl (as Ada Lark)" }),
    ];
    assert.deepStrictEqual(
      gluedTaglines(lines, actors).map((f) => f.name + " | " + f.detail),
      [
        'Grue Hungry Night-Stalkers 1 | heading "GRUE, HUNGRY NIGHT-STALKERS"; 2 actor(s)',
      ],
    );
  });
});

describe("unpunctuated", () => {
  test("notes without an ending stop; backgrounds only past a sentence", () => {
    const found = unpunctuated([
      actor({
        notes: ["Ends well.", "Ends in the middle of"],
        background: [
          { title: "Traits", text: "kind and quiet" },
          { title: "Ideology", text: "Seeks fog. Keeps the lamp lit" },
        ],
      }),
    ]);
    assert.deepStrictEqual(
      found.map((f) => f.detail),
      [
        "note 2: …Ends in the middle of",
        "Ideology: …Seeks fog. Keeps the lamp lit",
      ],
    );
  });
});

describe("incompleteActors", () => {
  test("lists missing skills, combat, characteristics and HP, not printed dashes", () => {
    const found = incompleteActors([
      actor(),
      actor({
        name: "Fog Thing",
        sanityLoss: "1/1D4",
        skills: {},
        combat: [],
        characteristics: { STR: { value: 50, raw: "50", marked: false } },
      }),
      actor({
        name: "Fog Ghost",
        characteristics: Object.fromEntries(
          ["STR", "CON", "SIZ", "DEX", "INT", "APP", "POW", "EDU", "HP"].map(
            (k) => [k, { value: null, raw: "—", marked: false }],
          ),
        ),
      }),
    ]);
    assert.deepStrictEqual(
      found.map((f) => `${f.name}: ${f.detail}`),
      ["Fog Thing: no skills; no combat; missing CON SIZ DEX INT POW; no HP"],
    );
  });
});

describe("attackGaps", () => {
  test("no value, or no damage outside Dodge and manoeuvres", () => {
    const found = attackGaps([
      actor({
        combat: [
          attack("Claw", { damage: null }),
          attack("Grab (mnvr)", { damage: null }),
          attack("Dodge", { damage: null }),
          attack("Gaze", { value: null }),
        ],
      }),
    ]);
    assert.deepStrictEqual(
      found.map((f) => f.detail),
      ["Claw: no damage", "Gaze: no value"],
    );
  });
});

describe("nameOddities", () => {
  test("flags spacing, split words and glued skill words", () => {
    assert.deepStrictEqual(nameOddities('Ada "Lamp " Lark'), [
      "space before punctuation or inside quotes",
    ]);
    assert.deepStrictEqual(nameOddities("Firearms (Rifl e)"), ["split word"]);
    assert.deepStrictEqual(nameOddities("Ada Bo Fighting"), [
      "skill word at end",
    ]);
    assert.deepStrictEqual(nameOddities("Colt .38 revolver"), []);
    assert.deepStrictEqual(nameOddities("Lamp #1"), ["odd characters"]);
  });
});

describe("groupTables and actorNameIssues", () => {
  const actors = [
    actor({ name: "Fog Wardens (Fhq) 1", notes: ["Use for all."] }),
    actor({ name: "Fog Wardens (Fhq) 2", notes: ["Use for all."] }),
    actor({ name: "The Grey Lady", notes: ["One."] }),
    actor({ name: "The Grey Man", notes: ["Another."] }),
    actor({ name: "Ada Lark" }),
    actor({ name: "Ada Lark" }),
  ];

  test("groups consecutive actors differing in their last word, same notes, no repeats", () => {
    assert.deepStrictEqual(groupTables(actors), [
      { name: "Fog Wardens (Fhq)", page: 5, labels: ["1", "2"] },
    ]);
  });

  test("checks a group once by its name; reports duplicates", () => {
    assert.deepStrictEqual(
      actorNameIssues(actors.slice(0, 4)).map((f) => `${f.name}: ${f.detail}`),
      [
        "Fog Wardens (Fhq) (group): short title-case parenthetical (an acronym?)",
      ],
    );
    assert.deepStrictEqual(
      actorNameIssues([actor(), actor({ name: "Bo Reed" }), actor()]).map(
        (f) => `${f.name}: ${f.detail}`,
      ),
      ["Ada Lark: printed 2 times"],
    );
  });
});

describe("itemIssues", () => {
  test("empty descriptions and names running a known name on", () => {
    const items = [
      { ...tome({ name: "Fog Sign Book of Mist", description: "Grey." }) },
      { ...tome({ name: "Lamp Rite (Folk)", description: "Lit." }) },
      { ...tome({ name: "Lamp Rite", description: "" }) },
    ] as any[];
    const found = itemIssues(items, [actor({ spells: ["Fog Sign"] })]);
    assert.deepStrictEqual(
      found.map((f) => `${f.name}: ${f.detail}`),
      [
        'Fog Sign Book of Mist (tome): name runs "Fog Sign" into more words',
        "Lamp Rite (tome): empty description",
      ],
    );
  });
});

describe("weaponSkillTally", () => {
  test("tallies weapons by linked skill, own skills first", () => {
    const weapon = (name: string, skill: string) => ({
      type: "weapon",
      name,
      system: { skill: { main: { name: skill } } },
    });
    const rows = weaponSkillTally([
      {
        name: "Ada Lark",
        items: [
          weapon("Brawl", "Fighting (Brawl)"),
          weapon("Lamp hook", "Fighting (Lamp hook)"),
          weapon("Glare", ""),
          { type: "skill", name: "Spot" },
        ],
      },
      { name: "Bo Reed", items: [weapon("Brawl", "Fighting (Brawl)")] },
    ]);
    assert.deepStrictEqual(
      rows.map((r) => [r.skill, r.kind, r.weapons]),
      [
        ["", "none", 1],
        ["Fighting (Lamp hook)", "per-weapon", 1],
        ["Fighting (Brawl)", "category", 2],
      ],
    );
  });
});
