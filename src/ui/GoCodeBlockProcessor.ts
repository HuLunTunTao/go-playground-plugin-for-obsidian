import {
	App,
	MarkdownPostProcessorContext,
	MarkdownView,
	Notice,
	TFile,
	WorkspaceLeaf,
} from "obsidian";
import { GoPlaygroundClient } from "../playground/GoPlaygroundClient";
import { MyPluginSettings } from "../settings";
import {
	findCodeBlockByLineRange,
	normalizeLanguage,
	updateCodeBlockLines,
	upsertRunResultBlockLines,
} from "../utils/markdown";

type SettingsGetter = () => MyPluginSettings;

export class GoCodeBlockProcessor {
	private app: App;
	private client: GoPlaygroundClient;
	private getSettings: SettingsGetter;

	constructor(app: App, client: GoPlaygroundClient, getSettings: SettingsGetter) {
		this.app = app;
		this.client = client;
		this.getSettings = getSettings;
	}

	register(
		registerFn: (
			processor: (el: HTMLElement, ctx: MarkdownPostProcessorContext) => void
		) => void,
		registerCodeBlock: (
			language: string,
			processor: (
				source: string,
				el: HTMLElement,
				ctx: MarkdownPostProcessorContext
			) => void
		) => void
	): void {
		registerFn((el, ctx) => this.decoratePreviewBlocks(el, ctx));
		registerCodeBlock(this.getSettings().runResultLanguage, (source, el) =>
			this.renderRunResult(source, el)
		);
	}

	private decoratePreviewBlocks(
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext
	): void {
		const settings = this.getSettings();
		const languageSet = new Set(
			settings.codeBlockLanguages.map((lang) => normalizeLanguage(lang))
		);

		const codeElements = el.querySelectorAll("pre > code");
		codeElements.forEach((codeEl) => {
			const classList = Array.from(codeEl.classList);
			const languageClass = classList.find((cls) => cls.startsWith("language-"));
			if (!languageClass) return;
			const language = languageClass.replace("language-", "");
			if (!languageSet.has(normalizeLanguage(language))) return;

			const pre = codeEl.parentElement;
			if (!pre || pre.dataset.goPlaygroundDecorated === "true") return;

			const section = ctx.getSectionInfo(pre);
			if (!section) return;

			const wrapper = document.createElement("div");
			wrapper.className = "go-playground-codeblock";

			const toolbar = this.createToolbar(
				ctx.sourcePath,
				section.lineStart,
				section.lineEnd
			);

			pre.dataset.goPlaygroundDecorated = "true";
			pre.parentElement?.insertBefore(wrapper, pre);
			wrapper.appendChild(toolbar);
			wrapper.appendChild(pre);
		});
	}

	private createToolbar(
		filePath: string,
		lineStart: number,
		lineEnd: number
	): HTMLElement {
		const toolbar = document.createElement("div");
		toolbar.className = "go-playground-toolbar";

		const formatButton = document.createElement("button");
		formatButton.type = "button";
		formatButton.textContent = "Format";
		formatButton.className = "go-playground-button";
		formatButton.addEventListener("click", async (event) => {
			event.preventDefault();
			event.stopPropagation();
			await this.handleFormat(filePath, lineStart, lineEnd, formatButton);
		});

		const runButton = document.createElement("button");
		runButton.type = "button";
		runButton.textContent = "Run";
		runButton.className = "go-playground-button";
		runButton.addEventListener("click", async (event) => {
			event.preventDefault();
			event.stopPropagation();
			await this.handleRun(filePath, lineStart, lineEnd, runButton);
		});

		toolbar.appendChild(formatButton);
		toolbar.appendChild(runButton);
		return toolbar;
	}

	private async handleFormat(
		filePath: string,
		lineStart: number,
		lineEnd: number,
		button: HTMLButtonElement
	): Promise<void> {
		const file = this.getFile(filePath);
		if (!file) {
			new Notice("Cannot find current file.");
			return;
		}

		button.disabled = true;
		const previewLeaf = this.getMarkdownLeafForPath(filePath);
		const wasPreview = previewLeaf?.view.getMode() === "preview";
		const previewScroll = wasPreview
			? previewLeaf?.view.previewMode.getScroll()
			: null;
		try {
			const content = await this.app.vault.read(file);
			const lines = content.split("\n");
			const settings = this.getSettings();
			const languageSet = new Set(
				settings.codeBlockLanguages.map((lang) => normalizeLanguage(lang))
			);
			const block = findCodeBlockByLineRange(
				lines,
				lineStart,
				lineEnd,
				languageSet
			);
			if (!block) {
				new Notice("No formattable Go code block found.");
				return;
			}

			const code = lines
				.slice(block.codeStartLine, block.codeEndLine)
				.join("\n");
			const response = await this.client.format(
				code,
				settings.formatFixImports
			);
			if (response.Error) {
				new Notice(response.Error);
				return;
			}

			updateCodeBlockLines(lines, block, response.Body);
			await this.app.vault.modify(file, lines.join("\n"));
			if (wasPreview) {
				previewLeaf?.view.previewMode.rerender();
				if (previewScroll !== null && previewScroll !== undefined) {
					requestAnimationFrame(() =>
						previewLeaf?.view.previewMode.applyScroll(previewScroll)
					);
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : "Format failed.";
			new Notice(message);
		} finally {
			button.disabled = false;
		}
	}

	private async handleRun(
		filePath: string,
		lineStart: number,
		lineEnd: number,
		button: HTMLButtonElement
	): Promise<void> {
		const file = this.getFile(filePath);
		if (!file) {
			new Notice("Cannot find current file.");
			return;
		}

		button.disabled = true;
		const previewLeaf = this.getMarkdownLeafForPath(filePath);
		const wasPreview = previewLeaf?.view.getMode() === "preview";
		const previewScroll = wasPreview
			? previewLeaf?.view.previewMode.getScroll()
			: null;
		try {
			const content = await this.app.vault.read(file);
			const lines = content.split("\n");
			const settings = this.getSettings();
			const languageSet = new Set(
				settings.codeBlockLanguages.map((lang) => normalizeLanguage(lang))
			);
			const block = findCodeBlockByLineRange(
				lines,
				lineStart,
				lineEnd,
				languageSet
			);
			if (!block) {
				new Notice("No runnable Go code block found.");
				return;
			}

			const code = lines
				.slice(block.codeStartLine, block.codeEndLine)
				.join("\n");
			const response = await this.client.compile(code, false);
			const output = this.client.getOutput(response);

			upsertRunResultBlockLines(
				lines,
				block,
				output,
				settings.runResultLanguage
			);
			await this.app.vault.modify(file, lines.join("\n"));
			if (wasPreview) {
				previewLeaf?.view.previewMode.rerender();
				if (previewScroll !== null && previewScroll !== undefined) {
					requestAnimationFrame(() =>
						previewLeaf?.view.previewMode.applyScroll(previewScroll)
					);
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : "Run failed.";
			new Notice(message);
		} finally {
			button.disabled = false;
		}
	}

	private renderRunResult(source: string, el: HTMLElement): void {
		const wrapper = el.createDiv({ cls: "go-playground-run-result" });
		const pre = wrapper.createEl("pre");
		pre.textContent = source;
	}

	private getFile(path: string): TFile | null {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) return file;
		return null;
	}

	private getMarkdownLeafForPath(path: string): WorkspaceLeaf | null {
		const leaves = this.app.workspace.getLeavesOfType("markdown");
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === path) {
				return leaf;
			}
		}
		return null;
	}
}
