export type FallbackField = { label: string; value: string };
export type FallbackSection = { title: string; fields: FallbackField[] };
export type FallbackStatus = { meta: string[]; sections: FallbackSection[]; raw: string };

const FIELD = /^\s*-?\s*(?:[-*]\s*)?([👤🆔📝💭👗🌸🚂📊🔥🐦⏱️📸💗💬]?\s*[^：:\n]{1,24})[：:]\s*(.*)$/;
const STATUS_TITLE = /^\s*-?\s*([^\n]{1,40}?的状态)\s*$/;

/** 保守识别常见 Markdown 状态栏：必须有角色状态标题和至少 4 个字段。 */
export function parseFallbackStatus(text: string): FallbackStatus | null {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	const start = lines.findIndex((line) => STATUS_TITLE.test(line));
	if (start < 0) return null;
	const meta = lines.slice(Math.max(0, start - 8), start).map((line) => line.trim()).filter((line) => /[📅⏰📍]/.test(line));
	const sections: FallbackSection[] = [];
	let current: FallbackSection | null = null;
	for (const line of lines.slice(start)) {
		const heading = STATUS_TITLE.exec(line);
		if (heading) {
			current = { title: heading[1], fields: [] };
			sections.push(current);
			continue;
		}
		if (!current) continue;
		const field = FIELD.exec(line);
		if (field) current.fields.push({ label: field[1].trim(), value: field[2].trim() });
		else if (line.trim() && current.fields.length) current.fields[current.fields.length - 1]!.value += `\n${line.trim()}`;
	}
	const count = sections.reduce((sum, section) => sum + section.fields.length, 0);
	if (count < 4) return null;
	return { meta, sections, raw: lines.slice(start).join("\n").trim() };
}

export function stripFallbackStatus(text: string): string {
	const status = parseFallbackStatus(text);
	if (!status) return text;
	const index = text.lastIndexOf(status.raw);
	if (index < 0) return text;
	return text.slice(0, index).replace(/(?:\s*[📅⏰📍][^\n]*\n?){1,8}\s*$/u, "").trim();
}
