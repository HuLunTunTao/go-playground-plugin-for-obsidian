import { App, PluginSettingTab, Setting } from "obsidian";
import MyPlugin from "./main";
import { t } from "./i18n";

export interface GoPlaygroundSettings {
	go_playground_base_url: string;
	codeBlockLanguages: string[];
	runResultLanguage: string;
	formatFixImports: boolean;
}

export const DEFAULT_SETTINGS: GoPlaygroundSettings = {
	go_playground_base_url: "https://play.golang.org",
	codeBlockLanguages: ["go", "golang"],
	runResultLanguage: "golang-run-result",
	formatFixImports: true,
};

export class GoPlaygroundSettingTab extends PluginSettingTab {
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

		new Setting(containerEl)
			.setName(t("SETTING_LANGS_NAME"))
			.setDesc(t("SETTING_LANGS_DESC"))
			.addText((text) =>
				text
					.setPlaceholder("Go, golang")
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
					.setPlaceholder("Golang-run-result")
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
