import {App, Editor, MarkdownView, Modal, Notice, Plugin} from 'obsidian';
import {DEFAULT_SETTINGS, MyPluginSettings, SampleSettingTab} from "./settings";
import {GoPlaygroundClient} from "./playground/GoPlaygroundClient";

// Remember to rename these classes and interfaces!

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	client: GoPlaygroundClient;

	async onload() {
		await this.loadSettings();

		// // This creates an icon in the left ribbon.
		// this.addRibbonIcon('dice', 'Sample', (evt: MouseEvent) => {
		// 	// Called when the user clicks the icon.
		// 	new Notice('This is a notice!');
		// });

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status bar text');

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-modal-simple',
			name: 'Open modal (simple)',
			callback: () => {
				new SampleModal(this.app).open();
			}
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'replace-selected',
			name: 'Replace selected content',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				editor.replaceSelection('Sample editor command');
			}
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-modal-complex',
			name: 'Open modal (complex)',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new SampleModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
				return false;
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		// this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
		// 	new Notice("Click");
		// });

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));

		this.addRibbonIcon('dice','Greet',()=>{
			new Notice('Hello, world');
		});

		this.registerMarkdownCodeBlockProcessor('csv', (source, el, ctx) => {
		const rows = source.split('\n').filter((row) => row.length > 0);

		const table = el.createEl('table');
		const body = table.createEl('tbody');

		for (let i = 0; i < rows.length; i++) {
			const rowText = rows[i];
			if (!rowText) continue;
			const cols = rowText.split(',');

			const row = body.createEl('tr');

			for (let j = 0; j < cols.length; j++) {
			row.createEl('td', { text: cols[j] });
			}
		}
		});

		testGet();

		// Initialize Go Playground client
		this.client = new GoPlaygroundClient(
			this.settings.go_playground_base_url,
			this.settings.go_playground_timeout
		);

		// Test Go Playground client
		this.testGoPlayground();

		console.log('Go Playground Plugin loaded');

	}

	onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<MyPluginSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async testGoPlayground() {
		try {
			const testCode = `package main

import "fmt"

func main() {
	fmt.Println("Hello from Go Playground!")
	fmt.Println("Testing Obsidian Plugin")
}`;

			console.log('=== Testing Go Playground Client ===');
			
			// Test 1: Compile and execute
			console.log('\n1. Testing compile()...');
			const compileResponse = await this.client.compile(testCode, false);
			console.log('Compile Response:', compileResponse);
			if (this.client.hasErrors(compileResponse)) {
				console.error('Compilation errors:', compileResponse.Errors);
			} else {
				const output = this.client.getOutput(compileResponse);
				console.log('Program output:', output);
			}

			// Test 2: Share code
			console.log('\n2. Testing share()...');
			const snippetId = await this.client.share(testCode);
			console.log('Snippet ID:', snippetId);

			// Test 3: View shared code
			console.log('\n3. Testing view()...');
			const viewedCode = await this.client.view(snippetId);
			console.log('Viewed code:', viewedCode);

			// Test 4: Format code
			console.log('\n4. Testing format()...');
			const messyCode = `package main
import "fmt"
func main(){
fmt.Println("Unformatted code")
}`;
			const formatResponse = await this.client.format(messyCode, true);
			if (formatResponse.Error) {
				console.error('Format error:', formatResponse.Error);
			} else {
				console.log('Formatted code:', formatResponse.Body);
			}

			// Test 5: Health check
			console.log('\n5. Testing health()...');
			const health = await this.client.health();
			console.log('Health status:', health);

			// Test 6: Version
			console.log('\n6. Testing version()...');
			const version = await this.client.version();
			console.log('Go version:', version);

			console.log('\n=== All tests completed ===');
		} catch (error) {
			console.error('Go Playground test failed:', error);
		}
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		let {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

async function testGet() {
  const resp = await fetch("https://httpbin.org/get");
  const data = await resp.json();
  console.log(data);
}
