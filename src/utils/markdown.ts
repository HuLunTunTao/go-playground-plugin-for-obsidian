export interface CodeBlockLines {
	language: string;
	startLine: number;
	endLine: number;
	codeStartLine: number;
	codeEndLine: number;
}

const FENCE_REGEX = /^```+/;
const FENCE_LANG_REGEX = /^```+\s*([^\s`]+)?/;

export function normalizeLanguage(language: string): string {
	return language.trim().toLowerCase();
}

export function isFenceLine(line: string | undefined): boolean {
	return typeof line === "string" && FENCE_REGEX.test(line.trim());
}

export function getFenceLanguage(line: string | undefined): string {
	const match = typeof line === "string" ? line.trim().match(FENCE_LANG_REGEX) : null;
	return match?.[1] ?? "";
}

export function parseCodeBlocks(lines: string[]): CodeBlockLines[] {
	const blocks: CodeBlockLines[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;

		const match = line.trim().match(FENCE_LANG_REGEX);
		if (!match) continue;

		const startLine = i;
		const language = match[1] ?? "";

		let endLine = i + 1;
		while (endLine < lines.length && !isFenceLine(lines[endLine])) {
			endLine++;
		}

		if (endLine >= lines.length) break;

		blocks.push({
			language,
			startLine,
			endLine,
			codeStartLine: startLine + 1,
			codeEndLine: endLine,
		});

		i = endLine;
	}

	return blocks;
}

export function findCodeBlockByLineRange(
	lines: string[],
	lineStart: number,
	lineEnd: number,
	languages: Set<string>
): CodeBlockLines | null {
	const blocks = findCodeBlocksByLineRange(lines, lineStart, lineEnd, languages);
	return blocks[0] ?? null;
}

export function findCodeBlocksByLineRange(
	lines: string[],
	lineStart: number,
	lineEnd: number,
	languages: Set<string>
): CodeBlockLines[] {
	const blocks = parseCodeBlocks(lines);
	return blocks.filter(
		(block) =>
			languages.has(normalizeLanguage(block.language)) &&
			block.startLine >= lineStart &&
			block.endLine <= lineEnd
	);
}

export function updateCodeBlockLines(
	lines: string[],
	block: CodeBlockLines,
	newCode: string
): void {
	const newLines = newCode.length > 0 ? newCode.replace(/\r\n/g, "\n").split("\n") : [];
	lines.splice(block.codeStartLine, block.codeEndLine - block.codeStartLine, ...newLines);
}

export function buildFencedCodeBlockText(
	lines: string[],
	block: CodeBlockLines
): string {
	const language = block.language?.trim() ?? "";
	const code = lines
		.slice(block.codeStartLine, block.codeEndLine)
		.join("\n");
	return `\`\`\`${language}\n${code}\n\`\`\``;
}

export function upsertRunResultBlockLines(
	lines: string[],
	block: CodeBlockLines,
	result: string,
	runResultLanguage: string
): void {
	const normalizedResult = sanitizeResult(result);
	const resultLines =
		normalizedResult.length > 0 ? normalizedResult.split("\n") : [];

	let scanLine = block.endLine + 1;
	while (scanLine < lines.length && lines[scanLine]?.trim() === "") {
		scanLine++;
	}

	if (
		scanLine < lines.length &&
		isFenceLine(lines[scanLine]) &&
		normalizeLanguage(getFenceLanguage(lines[scanLine])) ===
			normalizeLanguage(runResultLanguage)
	) {
		let endFence = scanLine + 1;
		while (endFence < lines.length && !isFenceLine(lines[endFence])) {
			endFence++;
		}
		if (endFence < lines.length) {
			lines.splice(scanLine + 1, endFence - (scanLine + 1), ...resultLines);
		} else {
			lines.splice(scanLine + 1, lines.length - (scanLine + 1), ...resultLines, "```");
		}
		return;
	}

	const insertPos = block.endLine + 1;
	const insertLines: string[] = [];
	if (insertPos < lines.length && lines[insertPos]?.trim() !== "") {
		insertLines.push("");
	}
	insertLines.push(`\`\`\`${runResultLanguage}`, ...resultLines, "```");
	lines.splice(insertPos, 0, ...insertLines);
}

export function sanitizeResult(result: string): string {
	return result.replace(/\r\n/g, "\n").replace(/```/g, "``\\`");
}
