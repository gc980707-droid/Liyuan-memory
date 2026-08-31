/**
 * Veridis-compatible, host-independent rewrite rules.
 * This module deliberately knows nothing about SillyTavern, DOM, or the model.
 */

import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

export type RewriteMode = "text" | "regex" | "simple";

export interface RewriteSubRule {
	name?: string;
	enabled?: boolean;
	mode?: RewriteMode;
	targets: string[];
	replacements: string[];
}

export interface RewriteRuleGroup {
	name: string;
	enabled?: boolean;
	subRules: RewriteSubRule[];
}

export interface RewriteConfig {
	enabled: boolean;
	rulesFile?: string;
	rules?: RewriteRuleGroup[];
	scope?: "visual" | "visual+history";
}

export interface RewriteProcessor {
	group: string;
	mode: RewriteMode;
	target: string;
	regex: RegExp;
	replacements: string[];
}

export interface NormalizeResult {
	rules: RewriteRuleGroup[];
	warnings: string[];
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function simplePattern(value: string): string {
	let out = "";
	for (let i = 0; i < value.length; i++) {
		const c = value[i];
		if (c === "*") out += "[\\s\\S]*?";
		else if (c === "?") out += "[\\s\\S]";
		else if (c === "{") {
			const end = value.indexOf("}", i + 1);
			if (end > i) {
				const choices = value.slice(i + 1, end).split(/[,，]/).map((x) => x.trim()).filter(Boolean);
				if (choices.length) { out += `(?:${choices.map(escapeRegExp).join("|")})`; i = end; continue; }
			}
			out += escapeRegExp(c);
		} else out += escapeRegExp(c);
	}
	return out;
}

function parseRegex(value: string): { source: string; flags: string } | null {
	const m = /^\/(.*)\/([dgimsuvy]*)$/.exec(value.trim());
	return m ? { source: m[1], flags: m[2].replace("y", "") } : { source: value, flags: "g" };
}

function canMatchEmpty(re: RegExp): boolean {
	re.lastIndex = 0;
	return re.test("");
}

function isRiskyRegex(source: string): boolean {
	// RegExp is synchronous and cannot be safely interrupted. Reject the common
	// catastrophic-backtracking shapes before they reach the display path.
	return source.length > 10_000 || /\([^)]*[+*][^)]*\)[+*{]/.test(source) || /(?:\.\*|\.\+)\s*(?:\.\*|\.\+)/.test(source);
}

/** Accepts Veridis' top-level array and { rules: [...] } wrapper. */
export function normalizeRewriteRules(payload: unknown): NormalizeResult {
	const raw = Array.isArray(payload) ? payload : payload && typeof payload === "object" ? (payload as { rules?: unknown }).rules : undefined;
	const warnings: string[] = [];
	if (!Array.isArray(raw)) return { rules: [], warnings: ["规则文件必须是数组或 {rules: []} 对象"] };
	const rules: RewriteRuleGroup[] = [];
	for (const group of raw) {
		if (!group || typeof group !== "object") { warnings.push("忽略无效规则组"); continue; }
		const g = group as Record<string, unknown>;
		const subRaw = Array.isArray(g.subRules) ? g.subRules : [];
		const subRules: RewriteSubRule[] = [];
		for (const sub of subRaw) {
			if (!sub || typeof sub !== "object") { warnings.push(`规则组「${String(g.name ?? "未命名")}」含无效子规则`); continue; }
			const s = sub as Record<string, unknown>;
			const mode: RewriteMode = s.mode === "regex" || s.mode === "simple" ? s.mode : "text";
			const targets = stringArray(s.targets).map((x) => x.trim()).filter(Boolean);
			if (!targets.length) continue;
			subRules.push({ name: typeof s.name === "string" ? s.name : undefined, enabled: s.enabled !== false, mode, targets, replacements: stringArray(s.replacements) });
		}
		rules.push({ name: typeof g.name === "string" && g.name.trim() ? g.name : `未命名规则组 ${rules.length + 1}`, enabled: g.enabled !== false, subRules });
	}
	return { rules, warnings };
}

export function compileRewriteProcessors(rules: RewriteRuleGroup[]): { processors: RewriteProcessor[]; warnings: string[] } {
	const processors: RewriteProcessor[] = [];
	const warnings: string[] = [];
	for (const group of rules) {
		if (group.enabled === false) continue;
		for (const sub of group.subRules ?? []) {
			if (sub.enabled === false) continue;
			for (const target of sub.targets ?? []) {
				try {
					const parsed = sub.mode === "regex" ? parseRegex(target) : { source: sub.mode === "simple" ? simplePattern(target) : escapeRegExp(target), flags: "g" };
					if (sub.mode === "regex" && isRiskyRegex(parsed.source)) { warnings.push(`忽略可能造成灾难性回溯的正则：${target}`); continue; }
					const regex = new RegExp(parsed.source, parsed.flags.includes("g") ? parsed.flags : `${parsed.flags}g`);
					if (canMatchEmpty(regex)) { warnings.push(`忽略空匹配规则：${target}`); continue; }
					processors.push({ group: group.name, mode: sub.mode ?? "text", target, regex, replacements: [...(sub.replacements ?? [])] });
				} catch (error) { warnings.push(`忽略非法规则「${target}」：${error instanceof Error ? error.message : String(error)}`); }
			}
		}
	}
	return { processors, warnings };
}

function replacement(values: string[], key: string, index: number): string {
	if (!values.length) return "";
	if (!key) return values[index % values.length];
	let hash = 2166136261;
	for (const c of `${key}:${index}`) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
	return values[(hash >>> 0) % values.length];
}

export function applyRewrite(text: string, processors: RewriteProcessor[], options: { deterministicKey?: string } = {}): string {
	let out = text;
	for (const processor of processors) {
		let index = 0;
		processor.regex.lastIndex = 0;
		out = out.replace(processor.regex, (...args: unknown[]) => {
			const match = String(args[0]);
			const captures = args.slice(1, -2);
			const value = replacement(processor.replacements, options.deterministicKey ?? "", index++);
			if (processor.mode === "regex") return value.replace(/\$(\d+)/g, (_, n) => String(captures[Number(n) - 1] ?? "")).replace(/\$&/g, match);
			return value;
		});
	}
	return out;
}

export function rewriteProcessorsForConfig(cwd: string, config: RewriteConfig | undefined, channel: "visual" | "history"): { processors: RewriteProcessor[]; warnings: string[] } {
	if (!config?.enabled || (channel === "history" && config.scope !== "visual+history")) return { processors: [], warnings: [] };
	let payload: unknown = config.rules ?? [];
	if (config.rulesFile) {
		try {
			const root = resolve(cwd, ".liyuan-rewrite") + sep;
			const file = resolve(cwd, config.rulesFile);
			if (!file.startsWith(root) || !file.endsWith(".json")) {
				return { processors: [], warnings: ["规则文件路径不安全，必须位于 .liyuan-rewrite/ 下；已回退为关闭"] };
			}
			// Kept here so callers do not need to know the on-disk format.
			payload = JSON.parse(readFileSync(file, "utf8"));
		} catch (error) {
			return { processors: [], warnings: [`规则文件加载失败，已回退为关闭：${error instanceof Error ? error.message : String(error)}`] };
		}
	}
	const normalized = normalizeRewriteRules(payload);
	const compiled = compileRewriteProcessors(normalized.rules);
	return { processors: compiled.processors, warnings: [...normalized.warnings, ...compiled.warnings] };
}

/** Rewrite narrative text while leaving fences, thinking, and status markup byte-identical. */
export function applyRewriteProtected(text: string, processors: RewriteProcessor[], options?: { deterministicKey?: string }): string {
	const protectedRe = /```[\s\S]*?```|<(?:(?:think|thinking|StatusPlaceHolderImpl)(?:\s[^>]*)?)[\s\S]*?<\/(?:think|thinking|StatusPlaceHolderImpl)\s*>|<StatusPlaceHolderImpl\s*\/?\s*>/gi;
	let cursor = 0;
	let out = "";
	for (const match of text.matchAll(protectedRe)) {
		const start = match.index ?? 0;
		out += applyRewrite(text.slice(cursor, start), processors, options) + match[0];
		cursor = start + match[0].length;
	}
	return out + applyRewrite(text.slice(cursor), processors, options);
}
