import { describe, test } from "node:test";
import assert from "node:assert/strict";

// The dialog class extends Foundry's application classes at load time.
(globalThis as any).foundry = {
  applications: {
    api: {
      ApplicationV2: class {},
      HandlebarsApplicationMixin: (base: any) => base,
    },
  },
};
const { footerButtons, isPulpEra } = await import("./importer-ui.ts");

describe("world era", () => {
  test("pulp, and any era ending in Pulp, is Pulp", () => {
    for (const era of ["pulp", "modernPulp", "downDarkerTrailsPulp"])
      assert.equal(isPulpEra(era), true, era);
    for (const era of ["standard", "modern", "downDarkerTrails", "", undefined])
      assert.equal(isPulpEra(era), false, String(era));
  });
});

describe("import dialog footer", () => {
  test("offers Import before an import", () => {
    assert.deepEqual(
      footerButtons(false, false).map((b) => [b.type, b.label]),
      [["submit", "coc-pdf-importer.Settings.Label"]],
    );
  });

  test("disables Import while importing", () => {
    const [button] = footerButtons(true, false);
    assert.equal(button.disabled, true);
  });

  test("offers Close once an import has finished", () => {
    assert.deepEqual(
      footerButtons(false, true).map((b) => [b.type, b.action, b.label]),
      [["button", "closeImporter", "coc-pdf-importer.Form.Close"]],
    );
  });
});
