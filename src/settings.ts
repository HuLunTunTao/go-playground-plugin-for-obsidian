import { App, PluginSettingTab, Setting } from "obsidian";
import MyPlugin from "./main";
import { t } from "./i18n";

export interface MyPluginSettings {
	go_playground_base_url: string;
	go_playground_timeout: number;
	codeBlockLanguages: string[];
	runResultLanguage: string;
	formatFixImports: boolean;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	go_playground_base_url: "https://play.golang.org",
	go_playground_timeout: 10000,
	codeBlockLanguages: ["go", "golang"],
	runResultLanguage: "golang-run-result",
	formatFixImports: true,
};

export class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName(t("SETTING_URL_NAME"))
			.setDesc(t("SETTING_URL_DESC"))
			.addText((text) =>
				text
					.setPlaceholder("https://play.golang.org")
					.setValue(this.plugin.settings.go_playground_base_url)
					.onChange(async (value) => {
						this.plugin.settings.go_playground_base_url = value.trim();
						await this.plugin.saveSettings();
					})
			);
		
		// During the limitation of Obsidian API, we temporarily disable this setting.
		// new Setting(containerEl)
		// 	.setName(t("SETTING_TIMEOUT_NAME"))
		// 	.setDesc(t("SETTING_TIMEOUT_DESC"))
		// 	.addText((text) =>
		// 		text
		// 			.setPlaceholder("10000")
		// 			.setValue(String(this.plugin.settings.go_playground_timeout))
		// 			.onChange(async (value) => {
		// 				const timeout = Number.parseInt(value, 10);
		// 				if (!Number.isNaN(timeout) && timeout > 0) {
		// 					this.plugin.settings.go_playground_timeout = timeout;
		// 					await this.plugin.saveSettings();
		// 				}
		// 			})
		// 	);

		new Setting(containerEl)
			.setName(t("SETTING_LANGS_NAME"))
			.setDesc(t("SETTING_LANGS_DESC"))
			.addText((text) =>
				text
					.setPlaceholder("go, golang")
					.setValue(this.plugin.settings.codeBlockLanguages.join(", "))
					.onChange(async (value) => {
						this.plugin.settings.codeBlockLanguages = value
							.split(",")
							.map((item) => item.trim())
							.filter((item) => item.length > 0);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("SETTING_RESULT_LANG_NAME"))
			.setDesc(t("SETTING_RESULT_LANG_DESC"))
			.addText((text) =>
				text
					.setPlaceholder("golang-run-result")
					.setValue(this.plugin.settings.runResultLanguage)
					.onChange(async (value) => {
						this.plugin.settings.runResultLanguage = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("SETTING_FIX_IMPORTS_NAME"))
			.setDesc(t("SETTING_FIX_IMPORTS_DESC"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.formatFixImports)
					.onChange(async (value) => {
						this.plugin.settings.formatFixImports = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
