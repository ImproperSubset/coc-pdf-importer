import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { embeddedIds, stableId } from "./ids.ts";

describe("stableId", () => {
  test("is 16 letters and digits, the same for the same key", () => {
    const id = stableId("parent|skill|Climb|0");
    assert.match(id, /^[A-Za-z0-9]{16}$/);
    assert.equal(stableId("parent|skill|Climb|0"), id);
    assert.notEqual(stableId("parent|skill|Climb|1"), id);
  });
});

describe("embeddedIds", () => {
  test("numbers same-typed, same-named documents by occurrence", () => {
    const a = embeddedIds("Parent0000000001");
    const b = embeddedIds("Parent0000000001");
    const knife = { type: "weapon", name: "Knife" };
    const first = a(knife);
    const second = a(knife);
    assert.notEqual(first, second);
    assert.equal(b(knife), first);
    assert.equal(b(knife), second);
    assert.notEqual(embeddedIds("Parent0000000002")(knife), first);
  });
});
