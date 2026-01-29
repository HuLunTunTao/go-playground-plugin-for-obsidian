import { requestUrl } from 'obsidian';

export interface GoPlaygroundRequest {
	version: number;
	body: string;
}

export interface GoPlaygroundEvent {
	Message: string;
	Kind: "stdout" | "stderr";
	Delay?: number;
}

export interface GoPlaygroundResponse {
	Errors: string;
	Events: GoPlaygroundEvent[] | null;
	Status?: number;
	IsTest?: boolean;
	TestsFailed?: number;
}

export interface GoPlaygroundFormatResponse {
	Body: string;
	Error: string;
}

export interface GoPlaygroundVersionResponse {
	Version: string;
	Release: string;
	Name: string;
}

export class GoPlaygroundClient {
	private baseUrl: string;
	private timeout: number;

	constructor(baseUrl: string, timeout: number = 10000) {
		this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
		this.timeout = timeout;
	}

	/**
	 * Execute Go code on the playground (legacy method, uses compile internally)
	 * @param code Go source code
	 * @returns Response from the playground
	 */
	async execute(code: string): Promise<GoPlaygroundResponse> {
		return this.compile(code, false);
	}

	/**
	 * Compile and run Go code on the playground
	 * @param code Go source code
	 * @param withVet Whether to run go vet
	 * @returns Response from the playground
	 */
	async compile(code: string, withVet: boolean = false): Promise<GoPlaygroundResponse> {
		const request: GoPlaygroundRequest = {
			version: 2,
			body: code
		};

		try {
			const response = await requestUrl({
				url: `${this.baseUrl}/compile`,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(request),
				throw: false
			});

			if (response.status !== 200) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const data: GoPlaygroundResponse = response.json;
			return data;
		} catch (error) {
			if (error instanceof Error) {
				throw error;
			}
			throw new Error('Unknown error occurred');
		}
	}

	/**
	 * Share Go code to the playground and get a snippet ID
	 * @param code Go source code
	 * @returns Snippet ID
	 */
	async share(code: string): Promise<string> {
		try {
			const response = await requestUrl({
				url: `${this.baseUrl}/share`,
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: code,
				throw: false
			});

			if (response.status !== 200) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			return response.text;
		} catch (error) {
			if (error instanceof Error) {
				throw error;
			}
			throw new Error('Unknown error occurred');
		}
	}

	/**
	 * Format Go code
	 * @param code Go source code
	 * @param fixImports Whether to fix imports
	 * @returns Formatted code response
	 */
	async format(code: string, fixImports: boolean = false): Promise<GoPlaygroundFormatResponse> {
		try {
			const formData = new URLSearchParams();
			formData.append('body', code);
			formData.append('imports', fixImports.toString());

			const response = await requestUrl({
				url: `${this.baseUrl}/fmt`,
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: formData.toString(),
				throw: false
			});

			if (response.status !== 200) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const data: GoPlaygroundFormatResponse = response.json;
			return data;
		} catch (error) {
			if (error instanceof Error) {
				throw error;
			}
			throw new Error('Unknown error occurred');
		}
	}

	/**
	 * Check health of the playground server
	 * @returns 'ok' if healthy
	 */
	async health(): Promise<string> {
		try {
			const response = await requestUrl({
				url: `${this.baseUrl}/_ah/health`,
				method: 'GET',
				throw: false
			});

			if (response.status !== 200) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			return response.text;
		} catch (error) {
			if (error instanceof Error) {
				throw error;
			}
			throw new Error('Unknown error occurred');
		}
	}

	/**
	 * Get the Go version of the playground server
	 * @returns Version information
	 */
	async version(): Promise<GoPlaygroundVersionResponse> {
		try {
			const response = await requestUrl({
				url: `${this.baseUrl}/version`,
				method: 'GET',
				throw: false
			});

			if (response.status !== 200) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const data: GoPlaygroundVersionResponse = response.json;
			return data;
		} catch (error) {
			if (error instanceof Error) {
				throw error;
			}
			throw new Error('Unknown error occurred');
		}
	}

	/**
	 * View code from a snippet ID
	 * @param snippetId Snippet ID
	 * @returns Go source code
	 */
	async view(snippetId: string): Promise<string> {
		try {
			const response = await requestUrl({
				url: `${this.baseUrl}/p/${snippetId}.go`,
				method: 'GET',
				throw: false
			});

			if (response.status !== 200) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			return response.text;
		} catch (error) {
			if (error instanceof Error) {
				throw error;
			}
			throw new Error('Unknown error occurred');
		}
	}

	/**
	 * Download code from a snippet ID
	 * @param snippetId Snippet ID
	 * @returns Go source code
	 */
	async download(snippetId: string): Promise<string> {
		try {
			const formData = new URLSearchParams();
			formData.append('download', 'true');

			const response = await requestUrl({
				url: `${this.baseUrl}/p/${snippetId}.go`,
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: formData.toString(),
				throw: false
			});

			if (response.status !== 200) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			return response.text;
		} catch (error) {
			if (error instanceof Error) {
				throw error;
			}
			throw new Error('Unknown error occurred');
		}
	}

	/**
	 * Get the output from the response
	 * @param response Response from playground
	 * @returns Combined output text
	 */
	getOutput(response: GoPlaygroundResponse): string {
		if (response.Errors) {
			return `Compilation Error:\n${response.Errors}`;
		}

		if (!response.Events || response.Events.length === 0) {
			return '';
		}

		return response.Events
			.map(event => event.Message)
			.join('');
	}

	/**
	 * Check if the response has errors
	 * @param response Response from playground
	 * @returns True if there are compilation errors
	 */
	hasErrors(response: GoPlaygroundResponse): boolean {
		return response.Errors !== '';
	}
}
