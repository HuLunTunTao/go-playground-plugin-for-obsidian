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
		formatButton.textContent = "格式化";
		formatButton.className = "go-playground-button";
		formatButton.addEventListener("click", async (event) => {
			event.preventDefault();
			event.stopPropagation();
			await this.handleFormat(view, formatButton);
		});

		const runButton = document.createElement("button");
		runButton.type = "button";
		runButton.textContent = "运行";
		runButton.className = "go-playground-button";
		runButton.addEventListener("click", async (event) => {
			event.preventDefault();
			event.stopPropagation();
			await this.handleRun(view, runButton);
		});

		toolbar.appendChild(formatButton);
		toolbar.appendChild(runButton);
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
				new Notice("未找到可格式化的 Go 代码块。");
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
			const message = error instanceof Error ? error.message : "格式化失败。";
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
				new Notice("未找到可运行的 Go 代码块。");
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
			const message = error instanceof Error ? error.message : "运行失败。";
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
	view.dispatch({
		changes: {
			from: 0,
			to: view.state.doc.length,
			insert: content,
		},
	});
}
