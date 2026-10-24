// Minimal ambient declarations for the Foundry VTT globals this module touches.
// Deliberately partial: only the members the importer actually calls are typed.
// The ApplicationV2 framework and the CoC7 system data model are left untyped
// (`any`) — full Foundry typings are out of scope here.

interface FoundryI18n {
  lang?: string;
  localize(key: string): string;
  format(key: string, data?: Record<string, unknown>): string;
}

interface FoundryFolder {
  id?: string;
  name?: string;
  type?: string;
  /** Parent folder (a Folder document, or an id in raw create data). */
  folder?: FoundryFolder | string | null;
  /** "a" (alphabetical) or "m" (manual, by `sort`). */
  sorting?: string;
  update?(data: object): Promise<unknown>;
}

interface FoundryActor {
  id?: string;
  name?: string;
  folder?: FoundryFolder | null;
  system?: any;
  createEmbeddedDocuments(
    type: string,
    data: object[],
    options?: object,
  ): Promise<unknown>;
  update(data: object): Promise<unknown>;
  toObject(): any;
  delete(): Promise<unknown>;
}

interface FoundryItem {
  id?: string;
  name?: string;
  type?: string;
  folder?: FoundryFolder | null;
  system?: any;
  toObject(): any;
  delete(): Promise<unknown>;
}

interface FoundryGame {
  i18n: FoundryI18n;
  actors?: {
    filter(predicate: (actor: FoundryActor) => boolean): FoundryActor[];
  };
  items?: { filter(predicate: (item: FoundryItem) => boolean): FoundryItem[] };
  folders?: {
    find(
      predicate: (folder: FoundryFolder) => boolean,
    ): FoundryFolder | undefined;
  };
  settings: {
    registerMenu(namespace: string, key: string, config: object): void;
  };
  // The CoC7 system API. `skillNames.getList()` resolves to a map of
  // CoCID -> skill item; `cocid.fromCoCIDRegexBest` returns the best item per
  // CoCID matching a regex (world + compendium, best per era/language), and
  // `cocid.fromCoCIDRegexAll` every matching item (`era: false`: any era).
  CoC7?: {
    skillNames?: {
      getList(): Promise<Record<string, any>>;
    };
    cocid?: {
      fromCoCIDRegexBest(options: {
        cocidRegExp: RegExp;
        type: string;
      }): Promise<any[]>;
      fromCoCIDRegexAll?(options: {
        cocidRegExp: RegExp;
        type: string;
        era?: boolean;
      }): Promise<any[]>;
    };
  };
}

interface FoundryUi {
  notifications: {
    info(message: string): void;
    error(message: string): void;
  };
}

// Globals provided by the running Foundry client (not bundled).
declare const game: FoundryGame;
declare const ui: FoundryUi;
declare const Hooks: { once(hook: string, fn: (...args: any[]) => void): void };
// `keepId` creates the document under the `_id` given in `data`.
declare const Actor: {
  create(data: object, options?: { keepId?: boolean }): Promise<FoundryActor>;
};
declare const Item: {
  create(data: object, options?: { keepId?: boolean }): Promise<FoundryItem>;
};
declare const Folder: {
  create(data: {
    name: string;
    type: string;
    folder?: string | null;
    sort?: number;
    sorting?: string;
  }): Promise<FoundryFolder>;
};
declare const foundry: {
  utils: {
    /** An absolute URL path for `path`, including the route prefix if set. */
    getRoute(path: string, prefix?: string | null): string;
  };
  applications: {
    api: {
      ApplicationV2: abstract new (...args: any[]) => unknown;
      // We don't type the ApplicationV2 framework: the mixin hands back a
      // subclassable base as `any`, so the config subclass stays dynamic.
      HandlebarsApplicationMixin(base: unknown): any;
    };
  };
};
