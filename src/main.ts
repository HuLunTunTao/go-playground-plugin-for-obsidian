import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, MyPluginSettings, SampleSettingTab } from "./settings";
import { GoPlaygroundClient } from "./playground/GoPlaygroundClient";
import { GoCodeBlockProcessor } from "./ui/GoCodeBlockProcessor";
import { createGoCodeBlockEditorExtension } from "./editor/GoCodeBlockEditorExtension";

export default class GoPlaygroundPlugin extends Plugin {
	settings: MyPluginSettings;
	client: GoPlaygroundClient;
	processor: GoCodeBlockProcessor;

	async onload() {
		await this.loadSettings();

		this.client = new GoPlaygroundClient(
			this.settings.go_playground_base_url,
			this.settings.go_playground_timeout
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
			this.settings.go_playground_base_url,
			this.settings.go_playground_timeout
		);
	}
}
