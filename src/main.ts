import { Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, MyPluginSettings, SampleSettingTab } from "./settings";
import { GoPlaygroundClient } from "./playground/GoPlaygroundClient";
import { GoCodeBlockProcessor } from "./ui/GoCodeBlockProcessor";
import { createGoCodeBlockEditorExtension } from "./editor/GoCodeBlockEditorExtension";
import { ShareInsertModal } from "./ui/ShareInsertModal";
import { t } from "./i18n";

export default class GoPlaygroundPlugin extends Plugin {
	settings: MyPluginSettings;
	client: GoPlaygroundClient;
	processor: GoCodeBlockProcessor;
	private insertLock = false;
	private lastInsertAt = 0;

	async onload() {
		await this.loadSettings();

		this.client = new GoPlaygroundClient(
			this.settings.go_playground_base_url
		);

		this.processor = new GoCodeBlockProcessor(
			this.app,
			this.client,
			() => this.settings
		);
		this.processor.register(
			(processor) => this.registerMarkdownPostProcessor(processor),
			(language, processor) =>
				this.registerMarkdownCodeBlockProcessor(language, processor)
		);

		this.registerEditorExtension(
			createGoCodeBlockEditorExtension(this.client, () => this.settings)
		);

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor) => {
				menu.addItem((item) => {
					item.setTitle(t("MENU_INSERT_SNIPPET")).onClick(() => {
						new ShareInsertModal(
							this.app,
							editor,
							this.client,
							() => this.settings,
							() => this.startInsert(),
							() => this.endInsert()
						).open();
					});
				});
			})
		);

		this.addSettingTab(new SampleSettingTab(this.app, this));

	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<MyPluginSettings>
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.client.updateConfig(
			this.settings.go_playground_base_url
		);
	}

	private startInsert(): boolean {
		const now = Date.now();
		if (this.insertLock || now - this.lastInsertAt < 500) {
			new Notice(t("NOTICE_TOO_FAST"));
			return false;
		}
		this.insertLock = true;
		this.lastInsertAt = now;
		return true;
	}

	private endInsert(): void {
		this.insertLock = false;
	}
}
