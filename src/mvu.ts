import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { readJsonFile } from "./jsonio.ts";

export type MvuData = Record<string, unknown>;

export type MvuOperation = {
	op: "replace" | "insert" | "remove" | "delta" | "move";
	path?: string;
	from?: string;
	to?: string;
	value?: unknown;
};

const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);

export function defaultMvuData(): MvuData {
	return {};
}

export function loadMvuData(file: string): MvuData {
	try {
		const raw = readJsonFile(file);
		return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as MvuData) : {};
	} catch {
		return {};
	}
}

export function saveMvuData(file: string, data: MvuData): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function pathParts(path: string): string[] {
	const parts = path.startsWith("/")
		? path.slice(1).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
		: path.split(".");
	if (!parts.length || parts.some((part) => !part || FORBIDDEN.has(part))) throw new Error(`非法变量路径：${path}`);
	return parts;
}

function parentAt(root: MvuData, path: string, create: boolean): { parent: Record<string, unknown> | unknown[]; key: string } {
	const parts = pathParts(path);
	let current: unknown = root;
	for (const part of parts.slice(0, -1)) {
		if (!current || typeof current !== "object") throw new Error(`变量路径不存在：${path}`);
		const container = current as Record<string, unknown>;
		if (!(part in container)) {
			if (!create) throw new Error(`变量路径不存在：${path}`);
			container[part] = {};
		}
		current = container[part];
	}
	if (!current || typeof current !== "object") throw new Error(`变量路径不存在：${path}`);
	return { parent: current as Record<string, unknown> | unknown[], key: parts.at(-1)! };
}

function getAt(root: MvuData, path: string): unknown {
	let current: unknown = root;
	for (const part of pathParts(path)) {
		if (!current || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

function setAt(root: MvuData, path: string, value: unknown, create: boolean): void {
	const { parent, key } = parentAt(root, path, create);
	if (Array.isArray(parent)) {
		if (key === "-") parent.push(value);
		else {
			const index = Number(key);
			if (!Number.isInteger(index) || index < 0 || index > parent.length) throw new Error(`非法数组索引：${path}`);
			if (create) parent.splice(index, 0, value);
			else parent[index] = value;
		}
	} else {
		if (!create && !(key in parent)) throw new Error(`变量路径不存在：${path}`);
		parent[key] = value;
	}
}

function removeAt(root: MvuData, path: string): unknown {
	const { parent, key } = parentAt(root, path, false);
	if (Array.isArray(parent)) {
		const index = Number(key);
		if (!Number.isInteger(index) || index < 0 || index >= parent.length) throw new Error(`非法数组索引：${path}`);
		return parent.splice(index, 1)[0];
	}
	if (!(key in parent)) throw new Error(`变量路径不存在：${path}`);
	const value = parent[key];
	delete parent[key];
	return value;
}

export function applyMvuOperations(data: MvuData, operations: MvuOperation[]): { data: MvuData; applied: string[]; warnings: string[] } {
	const next = structuredClone(data);
	const applied: string[] = [];
	const warnings: string[] = [];
	for (const operation of operations.slice(0, 200)) {
		try {
			if (!["replace", "insert", "remove", "delta", "move"].includes(operation.op)) throw new Error(`未知变量操作：${String(operation.op)}`);
			if (operation.op === "move") {
				const from = operation.from;
				const to = operation.to || operation.path;
				if (!from || !to) throw new Error("move 缺少 from/to");
				const value = structuredClone(getAt(next, from));
				if (value === undefined) throw new Error(`变量路径不存在：${from}`);
				setAt(next, to, value, true);
				removeAt(next, from);
				applied.push(`move ${from} -> ${to}`);
				continue;
			}
			if (!operation.path) throw new Error(`${operation.op} 缺少 path`);
			if (operation.op === "remove") removeAt(next, operation.path);
			else if (operation.op === "delta") {
				const raw = getAt(next, operation.path);
				const old = Array.isArray(raw) && raw.length === 2 && typeof raw[1] === "string" ? raw[0] : raw;
				if (typeof old !== "number" || typeof operation.value !== "number") throw new Error("delta 只支持数值");
				const value = Array.isArray(raw) ? [old + operation.value, raw[1]] : old + operation.value;
				setAt(next, operation.path, value, false);
			} else {
				const raw = getAt(next, operation.path);
				const value = operation.op === "replace" && Array.isArray(raw) && raw.length === 2 && typeof raw[1] === "string"
					? [operation.value, raw[1]]
					: operation.value;
				setAt(next, operation.path, value, operation.op === "insert");
			}
			applied.push(`${operation.op} ${operation.path}`);
		} catch (error) {
			warnings.push(error instanceof Error ? error.message : String(error));
		}
	}
	const encoded = JSON.stringify(next);
	if (encoded.length > 200_000) return { data, applied: [], warnings: ["变量数据超过 200KB，整批更新已拒绝"] };
	return { data: next, applied, warnings };
}

function looseJson(text: string): unknown {
	const normalized = text
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|\s)\/\/.*$/gm, "")
		.replace(/([{,]\s*)([A-Za-z_$\u4e00-\u9fff][\w$\u4e00-\u9fff-]*)\s*:/g, '$1"$2":')
		.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, value: string) => JSON.stringify(value.replace(/\\'/g, "'")))
		.replace(/,\s*([}\]])/g, "$1");
	return JSON.parse(normalized);
}

export function parseInitVar(content: string): MvuData | null {
	const start = content.indexOf("{");
	const end = content.lastIndexOf("}");
	if (start < 0 || end <= start) return null;
	try {
		const value = looseJson(content.slice(start, end + 1));
		return value && typeof value === "object" && !Array.isArray(value) ? (value as MvuData) : null;
	} catch {
		return null;
	}
}

export function parseMvuUpdates(text: string): MvuOperation[] {
	const envelope = /<UpdateVariable>([\s\S]*?)<\/UpdateVariable>/gi;
	const operations: MvuOperation[] = [];
	for (const match of text.matchAll(envelope)) {
		const body = match[1];
		const patch = /<JSONPatch>\s*([\s\S]*?)\s*<\/JSONPatch>/i.exec(body)?.[1];
		if (patch) {
			try {
				const parsed = JSON.parse(patch);
				if (Array.isArray(parsed)) operations.push(...parsed.filter((op) => op && typeof op === "object") as MvuOperation[]);
			} catch { /* ignore malformed patch */ }
		}
		const command = /_\.(set|insert|delete|add|move)\s*\(([^\n;]*)\)\s*;?/g;
		for (const cmd of body.matchAll(command)) {
			let args: unknown[];
			try { args = looseJson(`[${cmd[2].replace(/'/g, '"')}]`) as unknown[]; } catch { continue; }
			const path = typeof args[0] === "string" ? args[0] : "";
			if (cmd[1] === "set") operations.push({ op: "replace", path, value: args.length >= 3 ? args[2] : args[1] });
			else if (cmd[1] === "add") operations.push({ op: "delta", path, value: args[1] });
			else if (cmd[1] === "delete") operations.push({ op: "remove", path });
			else if (cmd[1] === "move") operations.push({ op: "move", from: path, to: String(args[1] ?? "") });
			else operations.push({ op: "insert", path, value: args.at(-1) });
		}
	}
	return operations;
}

export function stripMvuUpdates(text: string): string {
	return text.replace(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/gi, "").replace(/<StatusPlaceHolderImpl\s*\/>/gi, "").trim();
}

export function formatMvuData(data: MvuData): string {
	return Object.keys(data).length ? JSON.stringify(data, null, 2) : "（尚无 MVU 变量）";
}
