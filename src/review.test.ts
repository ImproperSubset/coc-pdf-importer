import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { conflictNote, fieldLabel, shownValue } from "./review.ts";

describe("review wording", () => {
  test("fields read as their sheet names", () => {
    assert.equal(fieldLabel("system.attribs.hp.max"), "Hit points (max)");
    assert.equal(fieldLabel("system.attribs.san.value"), "Sanity (current)");
    assert.equal(fieldLabel("system.characteristics.str.value"), "STR");
    assert.equal(fieldLabel("system.description.keeper"), "Keeper notes");
    assert.equal(fieldLabel("system.value", "Climb"), "Climb: value");
    assert.equal(
      fieldLabel("system.someNewThing.innerPart"),
      "some new thing › inner part",
    );
  });

  test("values read as plain text", () => {
    assert.equal(shownValue(true), "yes");
    assert.equal(shownValue(undefined), "(not there)");
    assert.equal(shownValue("<p>Old  notes.</p>"), "Old notes.");
    assert.equal(shownValue("x".repeat(200)).length, 158);
  });

  test("the note says why the module is asking", () => {
    const base = {
      itemId: null,
      itemName: null,
      path: "name",
      world: "A",
      pack: "B",
    };
    assert.match(
      conflictNote({ ...base, base: "C" }),
      /in play and by the import \(it was C when loaded\)/,
    );
    assert.match(conflictNote(base), /no record of what was loaded/);
  });
});
