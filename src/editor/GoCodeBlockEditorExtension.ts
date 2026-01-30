import { Notice, setIcon } from "obsidian";
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { GoPlaygroundClient } from "../playground/GoPlaygroundClient";
import { GoPlaygroundSettings } from "../settings";
import { t } from "../i18n";
import {
	findCodeBlockByLineRange,
	findCodeBlocksByLineRange,
	normalizeLanguage,
	updateCodeBlockLines,
	upsertRunResultBlockLines,
} from "../utils/markdown";

type SettingsGetter = () => GoPlaygroundSettings;

const EDITOR_TOOLBAR_TOP_OFFSET = 4;

export function createGoCodeBlockEditorExtension(
	client: GoPlaygroundClient,
	getSettings: SettingsGetter
) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				view.dom.classList.add("go-playground-editor");
				this.decorations = buildDecorations(view, client, getSettings);
			}

			update(update: { view: EditorView; docChanged: boolean; viewportChanged: boolean }) {
				if (update.docChanged || update.viewportChanged) {
					this.decorations = buildDecorations(update.view, client, getSettings);
				}
			}
		},
		{
			decorations: (v) => v.decorations,
		}
	);
}

function buildDecorations(
	view: EditorView,
	client: GoPlaygroundClient,
	getSettings: SettingsGetter
): DecorationSet {
	const settings = getSettings();
	const languageSet = new Set(
		settings.codeBlockLanguages.map((lang) => normalizeLanguage(lang))
	);

	const docText = view.state.doc.toString();
	const lines = docText.split("\n");
	const builder = new RangeSetBuilder<Decoration>();
	const seenStartLines = new Set<number>();

	view.visibleRanges.forEach((range) => {
		const startLine = view.state.doc.lineAt(range.from).number - 1;
		const endLine = view.state.doc.lineAt(range.to).number - 1;
		const blocks = findCodeBlocksByLineRange(
			lines,
			startLine,
			endLine,
			languageSet
		);
		blocks.forEach((block) => {
			if (seenStartLines.has(block.startLine)) return;
			seenStartLines.add(block.startLine);
			const line = view.state.doc.line(block.startLine + 1);
			const widget = new ToolbarWidget(
				client,
				getSettings,
				block.startLine,
				block.endLine
			);
			const deco = Decoration.widget({ widget, side: 1 });
			builder.add(line.from, line.from, deco);
		});
	});

	return builder.finish();
}

class ToolbarWidget extends WidgetType {
	private client: GoPlaygroundClient;
	private getSettings: SettingsGetter;
	private startLine: number;
	private endLine: number;
	private offsetObserver?: MutationObserver;
	private offsetResizeObserver?: ResizeObserver;

	constructor(
		client: GoPlaygroundClient,
		getSettings: SettingsGetter,
		startLine: number,
		endLine: number
	) {
		super();
		this.client = client;
		this.getSettings = getSettings;
		this.startLine = startLine;
		this.endLine = endLine;
	}

	toDOM(view: EditorView): HTMLElement {
		const toolbar = document.createElement("span");
		toolbar.className = "go-playground-toolbar is-editor";
		toolbar.setAttribute("contenteditable", "false");
		toolbar.style.setProperty(
			"--go-playground-editor-toolbar-top",
			`${EDITOR_TOOLBAR_TOP_OFFSET}px`
		);

		const formatButton = document.createElement("button");
		formatButton.type = "button";
		formatButton.className = "go-playground-button mod-format";
		setIcon(formatButton, "code-2");
		formatButton.insertAdjacentText("beforeend", t("BUTTON_FORMAT"));
		formatButton.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			void this.handleFormat(view, formatButton);
		});

		const runButton = document.createElement("button");
		runButton.type = "button";
		runButton.className = "go-playground-button mod-run";
		setIcon(runButton, "play");
		runButton.insertAdjacentText("beforeend", t("BUTTON_RUN"));
		runButton.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			void this.handleRun(view, runButton);
		});

		const shareButton = document.createElement("button");
		shareButton.type = "button";
		shareButton.className = "go-playground-button mod-share";
		setIcon(shareButton, "share-2");
		shareButton.insertAdjacentText("beforeend", t("BUTTON_SHARE"));
		shareButton.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			void this.handleShare(view, shareButton);
		});

		toolbar.appendChild(formatButton);
		toolbar.appendChild(runButton);
		toolbar.appendChild(shareButton);
		requestAnimationFrame(() => {
			updateEditorToolbarOffset(toolbar, view);
			const lineEl = toolbar.closest<HTMLElement>(".cm-line");
			if (!lineEl) return;
			this.offsetObserver = new MutationObserver(() => {
				updateEditorToolbarOffset(toolbar, view);
			});
			this.offsetObserver.observe(lineEl, {
				childList: true,
				subtree: true,
				attributes: true,
			});
			if (typeof ResizeObserver !== "undefined") {
				this.offsetResizeObserver = new ResizeObserver(() => {
					updateEditorToolbarOffset(toolbar, view);
				});
				this.offsetResizeObserver.observe(lineEl);
			}
		});
		return toolbar;
	}

	private async handleFormat(
		view: EditorView,
		button: HTMLButtonElement
	): Promise<void> {
		button.disabled = true;
		try {
			const lines = view.state.doc.toString().split("\n");
			const settings = this.getSettings();
			const languageSet = new Set(
				settings.codeBlockLanguages.map((lang) => normalizeLanguage(lang))
			);
			const block = findCodeBlockByLineRange(
				lines,
				this.startLine,
				this.endLine,
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
			replaceEditorContent(view, lines.join("\n"));
		} catch (error) {
			const message = error instanceof Error ? error.message : t("ERROR_FORMAT_FAILED");
			new Notice(message);
		} finally {
			button.disabled = false;
		}
	}

	private async handleRun(
		view: EditorView,
		button: HTMLButtonElement
	): Promise<void> {
		button.disabled = true;
		try {
			const lines = view.state.doc.toString().split("\n");
			const settings = this.getSettings();
			const languageSet = new Set(
				settings.codeBlockLanguages.map((lang) => normalizeLanguage(lang))
			);
			const block = findCodeBlockByLineRange(
				lines,
				this.startLine,
				this.endLine,
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
			replaceEditorContent(view, lines.join("\n"));
		} catch (error) {
			const message = error instanceof Error ? error.message : t("ERROR_RUN_FAILED");
			new Notice(message);
		} finally {
			button.disabled = false;
		}
	}

	private async handleShare(
		view: EditorView,
		button: HTMLButtonElement
	): Promise<void> {
		button.disabled = true;
		try {
			const lines = view.state.doc.toString().split("\n");
			const settings = this.getSettings();
			const languageSet = new Set(
				settings.codeBlockLanguages.map((lang) => normalizeLanguage(lang))
			);
			const block = findCodeBlockByLineRange(
				lines,
				this.startLine,
				this.endLine,
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
			new Notice(t("NOTICE_SHARE_COPIED"));
		} catch (error) {
			const message = error instanceof Error ? error.message : t("ERROR_SHARE_FAILED");
			new Notice(message);
		} finally {
			button.disabled = false;
		}
	}

	ignoreEvent(): boolean {
		return false;
	}

	destroy(): void {
		this.offsetObserver?.disconnect();
		this.offsetResizeObserver?.disconnect();
	}
}

function replaceEditorContent(view: EditorView, content: string): void {
	const scrollTop = view.scrollDOM.scrollTop;
	const scrollLeft = view.scrollDOM.scrollLeft;
	view.dispatch({
		changes: {
			from: 0,
			to: view.state.doc.length,
			insert: content,
		},
	});
	requestAnimationFrame(() => {
		view.scrollDOM.scrollTop = scrollTop;
		view.scrollDOM.scrollLeft = scrollLeft;
	});
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

function updateEditorToolbarOffset(toolbar: HTMLElement, view: EditorView): void {
	const baseRight = 8;
	const gap = 6;
	const lineEl = toolbar.closest<HTMLElement>(".cm-line");
	const candidates = lineEl
		? lineEl.querySelectorAll<HTMLElement>(
				".code-block-flair, .code-block-language, .cm-codeblock-language, button[data-language]"
			)
		: view.dom.querySelectorAll<HTMLElement>(
				".code-block-flair, .code-block-language, .cm-codeblock-language, button[data-language]"
			);

	let label: HTMLElement | null = null;
	if (candidates.length === 1) {
		label = candidates[0] ?? null;
	} else if (candidates.length > 1) {
		const toolbarTop = toolbar.getBoundingClientRect().top;
		let bestDiff = Number.POSITIVE_INFINITY;
		candidates.forEach((el) => {
			const diff = Math.abs(el.getBoundingClientRect().top - toolbarTop);
			if (diff < bestDiff) {
				bestDiff = diff;
				label = el;
			}
		});
	}

	if (!label) return;
	const width = label.getBoundingClientRect().width;
	if (width > 0) {
		toolbar.style.right = `${baseRight + width + gap}px`;
	}
}
