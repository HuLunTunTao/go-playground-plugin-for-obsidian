import { Notice } from "obsidian";
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { GoPlaygroundClient } from "../playground/GoPlaygroundClient";
import { MyPluginSettings } from "../settings";
import {
	findCodeBlockByLineRange,
	findCodeBlocksByLineRange,
	normalizeLanguage,
	updateCodeBlockLines,
	upsertRunResultBlockLines,
} from "../utils/markdown";

type SettingsGetter = () => MyPluginSettings;

export function createGoCodeBlockEditorExtension(
	client: GoPlaygroundClient,
	getSettings: SettingsGetter
) {
	return ViewPlugin.fromClass(
		class {
			decorations: Decoration.Set;

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
): Decoration.Set {
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

		const formatButton = document.createElement("button");
		formatButton.type = "button";
		formatButton.textContent = "Format";
		formatButton.className = "go-playground-button";
		formatButton.addEventListener("click", async (event) => {
			event.preventDefault();
			event.stopPropagation();
			await this.handleFormat(view, formatButton);
		});

		const runButton = document.createElement("button");
		runButton.type = "button";
		runButton.textContent = "Run";
		runButton.className = "go-playground-button";
		runButton.addEventListener("click", async (event) => {
			event.preventDefault();
			event.stopPropagation();
			await this.handleRun(view, runButton);
		});

		const shareButton = document.createElement("button");
		shareButton.type = "button";
		shareButton.textContent = "Share";
		shareButton.className = "go-playground-button";
		shareButton.addEventListener("click", async (event) => {
			event.preventDefault();
			event.stopPropagation();
			await this.handleShare(view, shareButton);
		});

		toolbar.appendChild(formatButton);
		toolbar.appendChild(runButton);
		toolbar.appendChild(shareButton);
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
			replaceEditorContent(view, lines.join("\n"));
		} catch (error) {
			const message = error instanceof Error ? error.message : "Format failed.";
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
			replaceEditorContent(view, lines.join("\n"));
		} catch (error) {
			const message = error instanceof Error ? error.message : "Run failed.";
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
				new Notice("No shareable Go code block found.");
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

	ignoreEvent(): boolean {
		return false;
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
	textarea.style.position = "fixed";
	textarea.style.opacity = "0";
	document.body.appendChild(textarea);
	textarea.focus();
	textarea.select();
	document.execCommand("copy");
	document.body.removeChild(textarea);
}
