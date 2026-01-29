import { App, Editor, Modal, Notice } from "obsidian";
import { GoPlaygroundClient } from "../playground/GoPlaygroundClient";
import { MyPluginSettings } from "../settings";

type SettingsGetter = () => MyPluginSettings;

export class ShareInsertModal extends Modal {
	private editor: Editor;
	private client: GoPlaygroundClient;
	private getSettings: SettingsGetter;
	private onInsertStart: () => boolean;
	private onInsertEnd: () => void;

	constructor(
		app: App,
		editor: Editor,
		client: GoPlaygroundClient,
		getSettings: SettingsGetter,
		onInsertStart: () => boolean,
		onInsertEnd: () => void
	) {
		super(app);
		this.editor = editor;
		this.client = client;
		this.getSettings = getSettings;
		this.onInsertStart = onInsertStart;
		this.onInsertEnd = onInsertEnd;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle("插入 Go Playground 代码");

		const input = contentEl.createEl("input", {
			type: "text",
			placeholder: "输入分享链接或 snippet id",
		});
		input.addClass("go-playground-input");

		const actions = contentEl.createDiv({ cls: "go-playground-modal-actions" });
		const submitButton = actions.createEl("button", {
			text: "确定",
		});
		submitButton.type = "button";

		const cancelButton = actions.createEl("button", {
			text: "取消",
		});
		cancelButton.type = "button";

		const handleSubmit = async () => {
			const value = input.value.trim();
			if (!value) return;
			if (!this.onInsertStart()) return;

			submitButton.disabled = true;
			try {
				const snippetId = extractSnippetId(value);
				if (!snippetId) {
					new Notice("无法解析 snippet id。");
					return;
				}

				const code = await this.client.view(snippetId);
				const language =
					this.getSettings().codeBlockLanguages[0] ?? "go";
				this.editor.replaceSelection(
					`\`\`\`${language}\n${code}\n\`\`\`\n`
				);
				this.close();
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "插入失败。";
				new Notice(message);
			} finally {
				submitButton.disabled = false;
				this.onInsertEnd();
			}
		};

		submitButton.addEventListener("click", handleSubmit);
		cancelButton.addEventListener("click", () => this.close());
		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				void handleSubmit();
			}
		});

		setTimeout(() => input.focus(), 0);
	}
}

function extractSnippetId(input: string): string | null {
	const trimmed = input.trim();
	const urlMatch = trimmed.match(/\/p\/([a-zA-Z0-9]+)(?:[/?#]|$)/);
	if (urlMatch?.[1]) {
		return urlMatch[1];
	}
	const idMatch = trimmed.match(/^[a-zA-Z0-9]+$/);
	return idMatch ? trimmed : null;
}
