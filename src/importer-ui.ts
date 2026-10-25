import { importDocument } from "./document.ts";
import { bookTitleFromFileName } from "./citation.ts";

// The dialog's footer: Import, or, once an import has finished and no new
// files are chosen, Close — Import would only run the same files again.
interface FooterButton {
  type: "submit" | "button";
  action?: string;
  icon: string;
  label: string;
  disabled?: boolean;
}
export function footerButtons(
  importing: boolean,
  finished: boolean,
): FooterButton[] {
  if (finished && !importing)
    return [
      {
        type: "button",
        action: "closeImporter",
        icon: "fa-solid fa-check",
        label: "coc-pdf-importer.Form.Close",
      },
    ];
  return [
    {
      type: "submit",
      icon: importing ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-upload",
      label: importing
        ? "coc-pdf-importer.Progress.Working"
        : "coc-pdf-importer.Settings.Label",
      disabled: importing,
    },
  ];
}

type ImportProgress = {
  name: string;
  status: "pending" | "working" | "done" | "error";
  created: number;
  failed: number;
  items: number;
  pulp: number;
  error?: string;
};

export class PdfImporterConfig extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
  static DEFAULT_OPTIONS = {
    id: "coc-pdf-importer-settings",
    tag: "form",
    window: {
      title: "coc-pdf-importer.Settings.Name",
      contentClasses: ["standard-form"],
    },
    form: {
      closeOnSubmit: false,
      handler: PdfImporterConfig.#onSubmit,
    },
    actions: {
      closeImporter: PdfImporterConfig.#onCloseImporter,
    },
    position: {
      width: 550,
    },
  };

  static PARTS = {
    form: {
      template: "modules/coc-pdf-importer/templates/pdf-importer.hbs",
      scrollable: [""],
    },
    progress: {
      template: "modules/coc-pdf-importer/templates/import-progress.hbs",
    },
    footer: {
      template: "modules/coc-pdf-importer/templates/import-footer.hbs",
    },
  };

  #importing = false;
  #finished = false;
  #progress: ImportProgress[] = [];

  _prepareContext(options: object) {
    const totalCreated = this.#progress.reduce((n, p) => n + p.created, 0);
    return {
      importing: this.#importing,
      progress: this.#progress.map((p) => ({
        name: p.name,
        status: p.status,
        label: this.#statusLabel(p),
      })),
      totalLabel: game.i18n.format("coc-pdf-importer.Progress.Total", {
        created: totalCreated,
      }),
      buttons: footerButtons(this.#importing, this.#finished),
    };
  }

  static #onCloseImporter(this: PdfImporterConfig) {
    this.close();
  }

  static async #onSubmit(
    event: Event,
    form: HTMLFormElement,
    formData: object,
  ) {
    const input = form.querySelector<HTMLInputElement>('input[name="files"]');
    const files = input?.files;
    if (!files || files.length === 0) {
      ui.notifications.error(
        game.i18n.localize("coc-pdf-importer.Errors.NoFiles"),
      );
      return;
    }
    const titles = Array.from(files).map(
      (file, i) =>
        form
          .querySelector<HTMLInputElement>(`input[name="bookTitle-${i}"]`)
          ?.value.trim() || bookTitleFromFileName(file.name),
    );
    await this.runImport(Array.from(files), titles);
  }

  // Offer an editable book title for each chosen file, prefilled from its
  // file name; the import cites it in each entry's Keeper notes.
  _onRender(context: object, options: object) {
    super._onRender?.(context, options);
    const form = this.element as HTMLFormElement;
    const input = form.querySelector<HTMLInputElement>('input[name="files"]');
    if (!input || input.dataset.cocBookTitles) return;
    input.dataset.cocBookTitles = "1";
    input.addEventListener("change", () => {
      // New files bring the Import button back.
      if (this.#finished) {
        this.#finished = false;
        this.render({ parts: ["footer"] });
      }
      const box = form.querySelector(".coc-book-titles");
      if (!box) return;
      box.replaceChildren();
      const files = Array.from(input.files ?? []);
      files.forEach((file, i) => {
        const group = document.createElement("div");
        group.className = "form-group";
        const label = document.createElement("label");
        label.textContent = file.name;
        const title = document.createElement("input");
        title.type = "text";
        title.name = `bookTitle-${i}`;
        title.value = bookTitleFromFileName(file.name);
        group.append(label, title);
        box.append(group);
      });
      if (files.length) {
        const hint = document.createElement("p");
        hint.className = "hint";
        hint.textContent = game.i18n.localize(
          "coc-pdf-importer.Form.BookTitleHint",
        );
        box.append(hint);
      }
    });
  }

  // Import each file in turn, re-rendering the progress list and the (disabled)
  // submit button between steps so the dialog reflects live status.
  async runImport(files: File[], titles: string[] = []) {
    this.#importing = true;
    this.#progress = files.map((f): ImportProgress => ({
      name: f.name,
      status: "pending",
      created: 0,
      failed: 0,
      items: 0,
      pulp: 0,
    }));
    await this.render({ parts: ["progress", "footer"] });

    for (let i = 0; i < files.length; i++) {
      const entry = this.#progress[i];
      entry.status = "working";
      await this.render({ parts: ["progress"] });
      try {
        const folderName = files[i].name.replace(/\.[^.]+$/, "");
        const result = await importDocument(
          new Uint8Array(await files[i].arrayBuffer()),
          { folderName, bookTitle: titles[i], notify: false },
        );
        entry.status = "done";
        entry.created = result.actors.created;
        entry.failed = result.actors.failed + result.items.failed;
        entry.items = result.items.created;
        entry.pulp = result.actors.pulp;
      } catch (e) {
        entry.status = "error";
        entry.error = e instanceof Error ? e.message : String(e);
      }
      await this.render({ parts: ["progress"] });
    }

    this.#importing = false;
    this.#finished = true;
    await this.render({ parts: ["progress", "footer"] });
  }

  #statusLabel(p: ImportProgress): string {
    switch (p.status) {
      case "working":
        return game.i18n.localize("coc-pdf-importer.Progress.Working");
      case "done": {
        const base = p.failed
          ? game.i18n.format("coc-pdf-importer.Progress.CreatedWithErrors", {
              created: p.created,
              failed: p.failed,
            })
          : game.i18n.format("coc-pdf-importer.Progress.Created", {
              created: p.created,
            });
        const extras = [
          p.pulp ? `${p.pulp} pulp` : "",
          p.items ? `${p.items} items` : "",
        ].filter(Boolean);
        return extras.length ? `${base} (+${extras.join(", +")})` : base;
      }
      case "error":
        return game.i18n.format("coc-pdf-importer.Errors.ErrorProcessing", {
          error: p.error ?? "",
        });
      default:
        return game.i18n.localize("coc-pdf-importer.Progress.Pending");
    }
  }
}
