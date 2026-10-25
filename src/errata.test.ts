import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections, bookCode } from "./errata.ts";
import { pulpItemDoc } from "./document.ts";
import { tome } from "./test-items.ts";

const corrections = [
  {
    printed: "Summon/Bind Mist Beast",
    corrected: "Contact Mist Beast",
    source: "a test erratum",
  },
  { printed: "Fog Warding", corrected: "Fog Ward", source: "a test reading" },
];

const actor = (spells: string[]): any => ({ name: "Testa", spells, notes: [] });

describe("bookCode", () => {
  test("is the product code that starts the file name", () => {
    assert.equal(bookCode("cha99999_-_a_test_book_v1.0"), "cha99999");
    assert.equal(bookCode("A Test Book"), "");
  });
});

describe("applyCorrections", () => {
  test("corrects an actor's spell and notes what was printed", () => {
    const a = actor(["Dim Light", "Summon/ Bind Mist Beast"]);
    applyCorrections(corrections, [a], []);
    assert.deepEqual(a.spells, ["Dim Light", "Contact Mist Beast"]);
    assert.deepEqual(a.notes, [
      "Errata: the spell printed as Summon/Bind Mist Beast is Contact Mist Beast (a test erratum).",
    ]);
  });

  test("corrects a tome's spell list and shows the note in its Keeper notes", () => {
    const t = tome({ spells: "Dim Light, Fog Warding." });
    applyCorrections(corrections, [], [t]);
    assert.equal(t.spells, "Dim Light, Fog Ward");
    const keeper = pulpItemDoc(t, "Test Source").system.description.keeper;
    assert.match(keeper, /Spells: Dim Light, Fog Ward</);
    assert.match(
      keeper,
      /Errata: the spell printed as Fog Warding is Fog Ward \(a test reading\)\./,
    );
  });

  test("leaves an uncorrected tome as printed", () => {
    const t = tome({ spells: "Dim Light." });
    applyCorrections(corrections, [], [t]);
    assert.equal(t.spells, "Dim Light.");
    assert.equal(t.errata, undefined);
  });

  test("returns the corrections that applied nowhere", () => {
    const unused = applyCorrections(corrections, [actor(["Fog Warding"])], []);
    assert.deepEqual(
      unused.map((c) => c.printed),
      ["Summon/Bind Mist Beast"],
    );
  });
});
