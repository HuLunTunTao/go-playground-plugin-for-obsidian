import {
	App,
	MarkdownPostProcessorContext,
	MarkdownView,
	Notice,
	TFile,
	WorkspaceLeaf,
	setIcon,
} from "obsidian";
import { GoPlaygroundClient } from "../playground/GoPlaygroundClient";
import { GoPlaygroundSettings } from "../settings";
import {
	buildFencedCodeBlockText,
	findCodeBlockByLineRange,
	normalizeLanguage,
	updateCodeBlockLines,
	upsertRunResultBlockLines,
} from "../utils/markdown";
import { t } from "../i18n";

type SettingsGetter = () => GoPlaygroundSettings;

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

			const container = pre.parentElement;
			if (!container) return;
			container.classList.add("go-playground-codeblock");

			const toolbar = this.createToolbar(
				ctx.sourcePath,
				section.lineStart,
				section.lineEnd
			);

			pre.dataset.goPlaygroundDecorated = "true";

			container.insertBefore(toolbar, pre);

			const nativeLabel = findNativeLanguageLabel(container);
			const copyButton = pre.querySelector<HTMLElement>(".copy-code-button");
			if (copyButton) {
				copyButton.classList.add("go-playground-native-copy");
				copyButton.addEventListener("click", (event) => {
					event.stopPropagation();
				});
			}

			if (nativeLabel && nativeLabel.dataset.goPlaygroundCopy !== "true") {
				nativeLabel.dataset.goPlaygroundCopy = "true";
				nativeLabel.addEventListener("click", (event) => {
					event.preventDefault();
					event.stopPropagation();
					void this.handleCopy(ctx.sourcePath, section.lineStart, section.lineEnd);
				});
			}

			if (nativeLabel) {
				const updateOffset = () =>
					requestAnimationFrame(() =>
						updateToolbarOffset(toolbar, nativeLabel)
					);
				updateOffset();
				container.addEventListener("mouseenter", updateOffset);
				container.addEventListener("mouseleave", updateOffset);
			}
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
		formatButton.className = "go-playground-button mod-format";
		setIcon(formatButton, "code-2");
		formatButton.insertAdjacentText("beforeend", t("BUTTON_FORMAT"));
		formatButton.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			void this.handleFormat(filePath, lineStart, lineEnd, formatButton);
		});

		const runButton = document.createElement("button");
		runButton.type = "button";
		runButton.className = "go-playground-button mod-run";
		setIcon(runButton, "play");
		runButton.insertAdjacentText("beforeend", t("BUTTON_RUN"));
		runButton.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			void this.handleRun(filePath, lineStart, lineEnd, runButton);
		});

		const shareButton = document.createElement("button");
		shareButton.type = "button";
		shareButton.className = "go-playground-button mod-share";
		setIcon(shareButton, "share-2");
		shareButton.insertAdjacentText("beforeend", t("BUTTON_SHARE"));
		shareButton.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			void this.handleShare(filePath, lineStart, lineEnd, shareButton);
		});

		toolbar.appendChild(formatButton);
		toolbar.appendChild(runButton);
		toolbar.appendChild(shareButton);
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
		const wasPreview = previewLeaf && (previewLeaf.view as MarkdownView).getMode() === "preview";
		const previewScroll = wasPreview
			? (previewLeaf.view as MarkdownView).previewMode.getScroll()
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
				new Notice(t("NOTICE_NO_FORMATTABLE_BLOCK"));
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
			if (wasPreview && previewLeaf) {
				(previewLeaf.view as MarkdownView).previewMode.rerender();
				if (previewScroll !== null && previewScroll !== undefined) {
					requestAnimationFrame(() =>
						(previewLeaf.view as MarkdownView).previewMode.applyScroll(previewScroll)
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
		const wasPreview = previewLeaf && (previewLeaf.view as MarkdownView).getMode() === "preview";
		const previewScroll = wasPreview
			? (previewLeaf.view as MarkdownView).previewMode.getScroll()
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
				new Notice(t("NOTICE_NO_RUNNABLE_BLOCK"));
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
			if (wasPreview && previewLeaf) {
				(previewLeaf.view as MarkdownView).previewMode.rerender();
				if (previewScroll !== null && previewScroll !== undefined) {
					requestAnimationFrame(() =>
						(previewLeaf.view as MarkdownView).previewMode.applyScroll(previewScroll)
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

	private async handleShare(
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
				new Notice(t("NOTICE_NO_SHAREABLE_BLOCK"));
				return;
			}

			const code = lines
				.slice(block.codeStartLine, block.codeEndLine)
				.join("\n");
			const snippetId = await this.client.share(code);
			const shareUrl = this.client.getShareUrl(snippetId.trim());
			await copyToClipboard(shareUrl);
			new Notice("Share link copied to clipboard.");
		} catch (error) {
			const message = error instanceof Error ? error.message : "Share failed.";
			new Notice(message);
		} finally {
			button.disabled = false;
		}
	}

	private async handleCopy(
		filePath: string,
		lineStart: number,
		lineEnd: number
	): Promise<void> {
		const file = this.getFile(filePath);
		if (!file) {
			new Notice("Cannot find current file.");
			return;
		}

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
				new Notice(t("NOTICE_NO_COPYABLE_BLOCK"));
				return;
			}

			const blockText = buildFencedCodeBlockText(lines, block);
			await copyToClipboard(blockText);
			new Notice(t("NOTICE_COPY_SUCCESS"));
		} catch (error) {
			const message = error instanceof Error ? error.message : "Copy failed.";
			new Notice(message);
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

async function copyToClipboard(text: string): Promise<void> {
	if (navigator.clipboard && navigator.clipboard.writeText) {
		await navigator.clipboard.writeText(text);
		return;
	}
	const textarea = document.createElement("textarea");
	textarea.value = text;
	textarea.setCssProps({
		position: "fixed",
		opacity: "0",
	});
	document.body.appendChild(textarea);
	textarea.focus();
	textarea.select();
	try {
		if (navigator.clipboard) {
			await navigator.clipboard.writeText(text);
		}
	} catch {
		// Fallback is not available in modern browsers
	} finally {
		document.body.removeChild(textarea);
	}
}

function findNativeLanguageLabel(container: HTMLElement): HTMLElement | null {
	const selectors = [
		".code-block-flair",
		".code-block-header__language",
		".code-block-language",
		".code-block-info",
		"button[data-language]",
	];

	for (const selector of selectors) {
		const el = container.querySelector<HTMLElement>(selector);
		if (el) return el;
	}
	return null;
}

function updateToolbarOffset(toolbar: HTMLElement, label: HTMLElement): void {
	const baseRight = 8;
	const gap = 6;
	const labelWidth = label.getBoundingClientRect().width;
	const offset = labelWidth > 0 ? baseRight + labelWidth + gap : baseRight;
	toolbar.style.right = `${offset}px`;
}
