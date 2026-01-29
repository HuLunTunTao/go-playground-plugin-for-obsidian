import { App, Editor, Modal, Notice } from "obsidian";
import { GoPlaygroundClient } from "../playground/GoPlaygroundClient";
import { MyPluginSettings } from "../settings";
import { t } from "../i18n";

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
		this.setTitle(t("MODAL_TITLE"));

		const input = contentEl.createEl("input", {
			type: "text",
			placeholder: t("MODAL_INPUT_PLACEHOLDER"),
		});
		input.addClass("go-playground-input");

		const actions = contentEl.createDiv({ cls: "go-playground-modal-actions" });
		const submitButton = actions.createEl("button", {
			text: t("BUTTON_CONFIRM"),
		});
		submitButton.type = "button";

		const cancelButton = actions.createEl("button", {
			text: t("BUTTON_CANCEL"),
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
					new Notice(t("NOTICE_ID_PARSE_ERROR"));
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
					error instanceof Error ? error.message : t("NOTICE_INSERT_ERROR");
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
