import {App, PluginSettingTab, Setting} from "obsidian";
import MyPlugin from "./main";

export interface MyPluginSettings {
	mySetting: string;
	go_playground_base_url: string;
	go_playground_timeout: number;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default',
	go_playground_base_url: 'https://play.golang.org',
	go_playground_timeout: 10000
}

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
			.setName('Settings #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Go Playground Base URL')
			.setDesc('Base URL for Go Playground')
			.addText(text => text
				.setPlaceholder('Enter Go Playground Base URL')
				.setValue(this.plugin.settings.go_playground_base_url)
				.onChange(async (value) => {
					this.plugin.settings.go_playground_base_url = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Request Timeout')
			.setDesc('Maximum wait time in milliseconds (official Go Playground typically supports up to 10-20 seconds, but you can set longer for third-party playgrounds)')
			.addText(text => text
				.setPlaceholder('10000')
				.setValue(String(this.plugin.settings.go_playground_timeout))
				.onChange(async (value) => {
					const timeout = parseInt(value);
					if (!isNaN(timeout) && timeout > 0) {
						this.plugin.settings.go_playground_timeout = timeout;
						await this.plugin.saveSettings();
					}
				}));
	}
}
