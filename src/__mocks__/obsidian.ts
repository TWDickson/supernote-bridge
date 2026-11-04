/* Test double for the parts of the Obsidian API the vault-side code uses. The
   `obsidian` package ships types only, so tests alias it to this module. It
   holds notes in memory and parses only the flat `key: "value"` frontmatter
   the plugin writes. */

export const Platform = { isMacOS: true, isIosApp: false, isAndroidApp: false, isTablet: false, isWin: false, isLinux: false };

export function normalizePath(path: string): string {
	const cleaned = path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
	return cleaned === "" ? "/" : cleaned;
}

export class TFile {
	constructor(public path: string) {}
}

export class Notice {
	constructor(public message: string) {}
}

export async function requestUrl(): Promise<never> {
	throw new Error("requestUrl is not available in unit tests");
}

type Frontmatter = Record<string, unknown>;

function splitFrontmatter(content: string): { fm: Frontmatter; body: string } {
	const match = /^---\n([\s\S]*?)\n---\n?/.exec(content);
	if (!match) return { fm: {}, body: content };
	const fm: Frontmatter = {};
	for (const line of (match[1] ?? "").split("\n")) {
		const kv = /^([\w-]+):\s*(.*)$/.exec(line);
		if (kv?.[1]) fm[kv[1]] = kv[2]?.startsWith('"') ? JSON.parse(kv[2]) : kv[2];
	}
	return { fm, body: content.slice(match[0].length) };
}

function joinFrontmatter(fm: Frontmatter, body: string): string {
	const lines = Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
	return `---\n${lines.join("\n")}\n---\n${body}`;
}

export class MemoryVault {
	files = new Map<string, string>();
	folders = new Set<string>();
	private handles = new Map<string, TFile>();

	private handle(path: string): TFile {
		let file = this.handles.get(path);
		if (!file) this.handles.set(path, (file = new TFile(path)));
		return file;
	}

	app = {
		vault: {
			getName: () => "Test Vault",
			getMarkdownFiles: () => [...this.files.keys()].filter((p) => p.endsWith(".md")).map((p) => this.handle(p)),
			getFolderByPath: (path: string) => (this.folders.has(path) ? { path } : null),
			getAbstractFileByPath: (path: string) => (this.files.has(path) ? this.handle(path) : null),
			createFolder: async (path: string) => void this.folders.add(path),
			create: async (path: string, data: string) => {
				if (this.files.has(path)) throw new Error(`exists: ${path}`);
				this.files.set(path, data);
				return this.handle(path);
			},
			read: async (file: TFile) => this.files.get(file.path) ?? "",
			process: async (file: TFile, fn: (data: string) => string) => {
				const next = fn(this.files.get(file.path) ?? "");
				this.files.set(file.path, next);
				return next;
			},
		},
		metadataCache: {
			getFileCache: (file: TFile) => ({ frontmatter: splitFrontmatter(this.files.get(file.path) ?? "").fm }),
		},
		fileManager: {
			processFrontMatter: async (file: TFile, fn: (fm: Frontmatter) => void) => {
				const { fm, body } = splitFrontmatter(this.files.get(file.path) ?? "");
				fn(fm);
				this.files.set(file.path, joinFrontmatter(fm, body));
			},
		},
	};

	/** Move a note, as a user renaming it in Obsidian would. */
	move(from: string, to: string): void {
		const content = this.files.get(from);
		if (content === undefined) throw new Error(`no such file: ${from}`);
		this.files.delete(from);
		this.handles.delete(from);
		this.files.set(to, content);
	}
}

/** A DOM element with just the helpers the plugin's modals call. */
export class FakeEl {
	children: FakeEl[] = [];
	text = "";
	cls = "";
	checked = false;
	indeterminate = false;
	private listeners = new Map<string, () => void>();

	constructor(public tag = "div") {}

	createEl(tag: string, opts: { text?: string; cls?: string } = {}): FakeEl {
		return this.add(tag, opts);
	}
	private add(tag: string, opts: { text?: string; cls?: string }): FakeEl {
		const el = new FakeEl(tag);
		el.text = opts.text ?? "";
		el.cls = opts.cls ?? "";
		this.children.push(el);
		return el;
	}
	createDiv(opts: { text?: string; cls?: string } = {}): FakeEl {
		return this.add("div", opts);
	}
	createSpan(opts: { text?: string; cls?: string } = {}): FakeEl {
		return this.add("span", opts);
	}
	empty(): void {
		this.children = [];
	}
	addClass(cls: string): void {
		this.cls = `${this.cls} ${cls}`.trim();
	}
	setCssProps(): void {}
	setAttr(): void {}
	addEventListener(type: string, fn: () => void): void {
		this.listeners.set(type, fn);
	}
	fire(type: string): void {
		this.listeners.get(type)?.();
	}
	/** Every element below this one, depth first. */
	all(): FakeEl[] {
		return this.children.flatMap((child) => [child, ...child.all()]);
	}
}

export function setIcon(): void {}

export class AbstractInputSuggest {
	onSelect(): this {
		return this;
	}
}

const COMPONENT_ADDERS = new Set(["addText", "addDropdown", "addToggle", "addButton", "addExtraButton"]);

/** Any chain of calls and property reads succeeds; Setting's component
 *  callbacks (addText etc.) run with another chain, so code building a row
 *  runs end to end. Event listeners are never fired. */
function chain(name = ""): unknown {
	return new Proxy(function () {}, {
		get: (_target, prop) => (prop === "then" ? undefined : chain(String(prop))),
		apply: (_target, _this, args: unknown[]) => {
			if (COMPONENT_ADDERS.has(name)) {
				for (const arg of args) if (typeof arg === "function") (arg as (c: unknown) => void)(chain());
			}
			return chain();
		},
	});
}

/** Records its rows in the container, so tests can count them. */
export class Setting {
	constructor(containerEl: FakeEl) {
		containerEl.createDiv({ cls: "setting-item" });
		return chain() as Setting;
	}
}

export const editorLivePreviewField = undefined;

/** Mirrors Obsidian's Modal.open(): it overwrites `this.selection` with the
 *  saved text selection right before calling onOpen(). */
export class Modal {
	contentEl = new FakeEl();
	selection: unknown;
	constructor(public app: unknown) {}
	setTitle(): this {
		return this;
	}
	open(): void {
		this.selection = null;
		void this.onOpen();
	}
	close(): void {}
	async onOpen(): Promise<void> {}
}
