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
const { footerButtons } = await import("./importer-ui.ts");

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
