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
	sanitizeResult,
	isFenceLine,
	getFenceLanguage,
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
		formatButton.createSpan({ text: t("BUTTON_FORMAT") });
		formatButton.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			void this.handleFormat(view, formatButton);
		});

		const runButton = document.createElement("button");
		runButton.type = "button";
		runButton.className = "go-playground-button mod-run";
		setIcon(runButton, "play");
		runButton.createSpan({ text: t("BUTTON_RUN") });
		runButton.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			void this.handleRun(view, runButton);
		});

		const shareButton = document.createElement("button");
		shareButton.type = "button";
		shareButton.className = "go-playground-button mod-share";
		setIcon(shareButton, "share-2");
		shareButton.createSpan({ text: t("BUTTON_SHARE") });
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

			// Normalized Body. Logic adapted to minimize disturbance.
			const normalizedBody = response.Body.replace(/\r\n/g, "\n");
			
			// Range Calculation for Replacement
			// block.codeStartLine (index in lines) -> First line of code.
			// block.codeEndLine (index in lines) -> Closing fence line (exclusive of code).
			
			// We want to replace lines from `block.codeStartLine` to `block.codeEndLine - 1`.
			// Wait, block.codeEndLine is the index of the closing fence line in the lines array.
			// But slice is exclusive.
			// If array: 0: ```, 1: code, 2: ```.
			// codeStartLine = 1. codeEndLine = 2.
			// We want to replace line 1.
			
			// CM6 Line numbering: 1-based.
			// Start Line for replacement: block.codeStartLine + 1.
			// End Line for replacement: block.codeEndLine - 1 + 1 (since block.codeEndLine is exclusive index, -1 gives last code line index, +1 for CM6).
			// => block.codeEndLine.
			
			const fromLineNumber = block.codeStartLine + 1;
			const toLineNumber = block.codeEndLine;
			
			let fromPos: number;
			let toPos: number;
			
			if (fromLineNumber > toLineNumber) {
				// Empty block
				// Insert at end of opening fence line? Or start of closing fence line?
				// Opening fence is at block.startLine (0-based) => block.startLine + 1 (1-based).
				const openingFenceLine = view.state.doc.line(block.startLine + 1);
				fromPos = openingFenceLine.to + 1; // Start of next line (if exists)
				toPos = fromPos;
			} else {
				fromPos = view.state.doc.line(fromLineNumber).from;
				toPos = view.state.doc.line(toLineNumber).to;
			}
			
			view.dispatch({
				changes: {
					from: fromPos,
					to: toPos,
					insert: normalizedBody
				}
			});

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
			const runResultLanguage = settings.runResultLanguage;

			const normalizedResult = sanitizeResult(output);
			const resultLines =
				normalizedResult.length > 0 ? normalizedResult.split("\n") : [];
			const resultLanguage = normalizeLanguage(runResultLanguage);

			// Scan for existing result block
			let scanLineIndex = block.endLine + 1;
			while (scanLineIndex < lines.length && lines[scanLineIndex]?.trim() === "") {
				scanLineIndex++;
			}

			let existingBlockStart = -1;
			let existingBlockEnd = -1; // Exclusive index

			if (
				scanLineIndex < lines.length &&
				isFenceLine(lines[scanLineIndex]) &&
				normalizeLanguage(getFenceLanguage(lines[scanLineIndex])) === resultLanguage
			) {
				existingBlockStart = scanLineIndex;
				let endFence = scanLineIndex + 1;
				while (endFence < lines.length && !isFenceLine(lines[endFence])) {
					endFence++;
				}
				if (endFence < lines.length) {
					existingBlockEnd = endFence + 1; // Include closing fence in range? Yes.
				} else {
					existingBlockEnd = lines.length;
				}
			}

			const newBlockContent =
				`\`\`\`${runResultLanguage}\n` +
				(resultLines.length > 0 ? resultLines.join("\n") + "\n" : "") +
				"```";

			if (existingBlockStart !== -1) {
				// Replace existing block
				// Range: existingBlockStart to existingBlockEnd - 1 (indices)
				// CM6: existingBlockStart + 1 to existingBlockEnd
				
				const fromLine = view.state.doc.line(existingBlockStart + 1);
				// To line: if existingBlockEnd is length, it means last line inclusive?
				// existingBlockEnd is exclusive index.
				// Last line index = existingBlockEnd - 1.
				// CM6 line = existingBlockEnd.
				
				let toPos: number;
				if (existingBlockEnd <= view.state.doc.lines) {
					toPos = view.state.doc.line(existingBlockEnd).to;
				} else {
					toPos = view.state.doc.length; // Should match
				}
				
				view.dispatch({
					changes: {
						from: fromLine.from,
						to: toPos,
						insert: newBlockContent
					}
				});
			} else {
				// Insert new block
				const closingFenceLine = view.state.doc.line(block.endLine + 1);
				view.dispatch({
					changes: {
						from: closingFenceLine.to,
						insert: "\n\n" + newBlockContent
					}
				});
			}

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