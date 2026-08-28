/**
 * 梨园原生 MVU 最小核心：读取开场白里的 Initvar。
 *
 * 这里只处理数据协议，不模拟 SillyTavern。状态保存仍由 Agent 会话树负责，
 * 浏览器状态栏只通过 getAllVariables() 读取当前会话投影。
 */

import { parse } from "yaml";
import type { WorldState } from "./types.ts";

/** 从一条开场白提取该开局自己的 <initvar> 数据。 */
export function parseGreetingInitvar(text: string): Record<string, unknown> | null {
	const match = /<initvar\s*>([\s\S]*?)<\/initvar\s*>/i.exec(text);
	if (!match) return null;
	let body = match[1].trim();
	const fenced = /^```(?:ya?ml)?\s*\n([\s\S]*?)\n```$/i.exec(body);
	if (fenced) body = fenced[1].trim();
	try {
		const value = parse(body) as unknown;
		return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** 按作者卡字段的点路径更新状态树；不修改原树。 */
export function applyMvuPatch(tree: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
	const next = structuredClone(tree);
	for (const [path, value] of Object.entries(patch)) {
		const parts = path.split(".").map((part) => part.trim()).filter(Boolean);
		if (parts.length === 0) continue;
		let node: Record<string, unknown> = next;
		for (const part of parts.slice(0, -1)) {
			if (!node[part] || typeof node[part] !== "object" || Array.isArray(node[part])) node[part] = {};
			node = node[part] as Record<string, unknown>;
		}
		node[parts[parts.length - 1]] = value;
	}
	restoreProtectedMvuFields(next, tree);
	return next;
}

const objectAt = (value: unknown, path: string[]): Record<string, unknown> | null => {
	let current = value;
	for (const key of path) {
		if (!current || typeof current !== "object" || Array.isArray(current)) return null;
		current = (current as Record<string, unknown>)[key];
	}
	return current && typeof current === "object" && !Array.isArray(current) ? (current as Record<string, unknown>) : null;
};

const scalarAt = (value: unknown, paths: string[][]): string => {
	for (const path of paths) {
		let current: unknown = value;
		for (const key of path) {
			if (!current || typeof current !== "object" || Array.isArray(current)) {
				current = undefined;
				break;
			}
			current = (current as Record<string, unknown>)[key];
		}
		if (typeof current === "string" && current.trim()) return current;
	}
	return "";
};

const clockValue = (value: string): number | null => {
	const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(value.trim());
	return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) : null;
};

const PROTECTED_KEYS = new Set(["过往", "初见", "死因", "外貌特征", "名器特点", "性交经历"]);

function restoreProtectedMvuFields(next: Record<string, unknown>, previous: Record<string, unknown>): void {
	for (const [key, oldValue] of Object.entries(previous)) {
		if (PROTECTED_KEYS.has(key)) {
			next[key] = structuredClone(oldValue);
			continue;
		}
		const newValue = next[key];
		if (oldValue && typeof oldValue === "object" && !Array.isArray(oldValue) && newValue && typeof newValue === "object" && !Array.isArray(newValue)) {
			restoreProtectedMvuFields(newValue as Record<string, unknown>, oldValue as Record<string, unknown>);
		}
	}
}

/** 每个完成的剧情回合至少推进五分钟，除非场记明确给出新时间。 */
export function mvuTimePatchIfMissing(tree: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
	const current = scalarAt(tree, [["坐标", "时间"], ["世界", "当前时间"], ["时间"]]);
	const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(current.trim());
	if (!match) return patch;
	const currentDate = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])));
	const timePath = Object.keys(patch).find(
		(path) => path === "time" || path === "时间" || /(?:^|\.)时间$/.test(path) || /当前时间$/.test(path),
	);
	if (timePath && typeof patch[timePath] === "string") {
		const nextMatch = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(patch[timePath].trim());
		if (nextMatch) {
			const proposed = new Date(Date.UTC(Number(nextMatch[1]), Number(nextMatch[2]) - 1, Number(nextMatch[3]), Number(nextMatch[4]), Number(nextMatch[5])));
			if (proposed.getTime() >= currentDate.getTime()) return patch;
		}
	}
	const date = new Date(currentDate.getTime() + 5 * 60 * 1000);
	const pad = (n: number) => String(n).padStart(2, "0");
	return {
		...patch,
		"坐标.时间": `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`,
	};
}

function storagePatch(inventory: unknown[]): Record<string, unknown> {
	const bag: Record<string, unknown> = {};
	const safe: Record<string, unknown> = {};
	for (const raw of inventory) {
		if (typeof raw !== "string" || !raw.trim()) continue;
		const item = raw.trim();
		if (/保险箱|保险库|安全箱/.test(item)) safe[item.replace(/（保险箱内）|\(保险箱内\)/g, "").trim()] = "a1";
		else bag[item] = 1;
	}
	const patch: Record<string, unknown> = {};
	if (Object.keys(safe).length > 0) patch["主角.资产.保险箱内容.存放物品"] = safe;
	if (Object.keys(bag).length > 0) patch["主角.资产.背包内容.存放物品"] = bag;
	return patch;
}

function mergeStoragePatch(tree: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
	if (!Array.isArray(patch.inventory)) return {};
	const assets = tree["主角"] && typeof tree["主角"] === "object" ? (tree["主角"] as Record<string, unknown>)["资产"] : undefined;
	const currentAssets = assets && typeof assets === "object" ? (assets as Record<string, unknown>) : {};
	const currentBag = currentAssets["背包内容"] && typeof currentAssets["背包内容"] === "object" ? (currentAssets["背包内容"] as Record<string, unknown>)["存放物品"] : undefined;
	const currentSafe = currentAssets["保险箱内容"] && typeof currentAssets["保险箱内容"] === "object" ? (currentAssets["保险箱内容"] as Record<string, unknown>)["存放物品"] : undefined;
	const incoming = storagePatch(patch.inventory);
	const result: Record<string, unknown> = {};
	if (incoming["主角.资产.背包内容.存放物品"] && currentBag && typeof currentBag === "object") {
		result["主角.资产.背包内容.存放物品"] = {
			...(currentBag as Record<string, unknown>),
			...(incoming["主角.资产.背包内容.存放物品"] as Record<string, unknown>),
		};
	} else if (incoming["主角.资产.背包内容.存放物品"]) {
		Object.assign(result, { "主角.资产.背包内容.存放物品": incoming["主角.资产.背包内容.存放物品"] });
	}
	if (incoming["主角.资产.保险箱内容.存放物品"] && currentSafe && typeof currentSafe === "object") {
		result["主角.资产.保险箱内容.存放物品"] = {
			...(currentSafe as Record<string, unknown>),
			...(incoming["主角.资产.保险箱内容.存放物品"] as Record<string, unknown>),
		};
	} else if (incoming["主角.资产.保险箱内容.存放物品"]) {
		Object.assign(result, { "主角.资产.保险箱内容.存放物品": incoming["主角.资产.保险箱内容.存放物品"] });
	}
	return result;
}

/** 将兼容旧账本工具提交的通用补丁同步到作者 MVU 树。 */
export function applyWorldPatchToMvu(tree: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
	const next: Record<string, unknown> = {};
	const explicitMvuTime = ["坐标.时间", "世界.当前时间", "时间"].find((path) => typeof patch[path] === "string");
	if (explicitMvuTime) next[explicitMvuTime] = patch[explicitMvuTime];
	else if (typeof patch.time === "string") next["坐标.时间"] = patch.time;
	if (typeof patch.location === "string") {
		const location = patch.location;
		const parts = location.split(/\s+/).filter(Boolean);
		if (parts.length > 0) next["坐标.当前状态"] = parts[0];
		if (parts.length > 1) next["坐标.当前位置.区域"] = parts[1];
		if (parts.length > 2) next["坐标.当前位置.具体设施"] = parts.slice(2).join(" ");
	}
	if (Array.isArray(patch.inventory)) Object.assign(next, mergeStoragePatch(tree, patch));
	if (patch.characters && typeof patch.characters === "object" && !Array.isArray(patch.characters)) {
		for (const [name, value] of Object.entries(patch.characters as Record<string, unknown>)) {
			if (!value || typeof value !== "object" || Array.isArray(value)) continue;
			const character = value as Record<string, unknown>;
			if (typeof character.status === "string") next[`角色列表.${name}.当前状态`] = character.status;
			if (typeof character.notes === "string") next[`角色列表.${name}.当前身份`] = character.notes;
			if (typeof character.affinity === "number") next[`角色列表.${name}.好感度`] = character.affinity;
		}
	}
	const presence = patch.characters && typeof patch.characters === "object" && !Array.isArray(patch.characters)
		? Object.fromEntries(
				Object.entries(patch.characters as Record<string, unknown>)
					.filter(([, value]) => value && typeof value === "object" && !Array.isArray(value))
					.filter(([, value]) => !/(?:已死亡|死亡|离场|撤退|回城|离开)/.test(String((value as Record<string, unknown>).status ?? "")))
					.map(([name]) => [name, true]),
			)
		: undefined;
	if (presence) {
		const current = tree["在场角色列表"] && typeof tree["在场角色列表"] === "object"
			? (tree["在场角色列表"] as Record<string, unknown>)
			: {};
		const merged = { ...current, ...presence };
		for (const [name, value] of Object.entries(patch.characters as Record<string, unknown>)) {
			if (value && typeof value === "object" && !Array.isArray(value) && /(?:已死亡|死亡|离场|撤退|回城|离开)/.test(String((value as Record<string, unknown>).status ?? ""))) {
				delete merged[name];
			}
		}
		next["在场角色列表"] = merged;
	}
	return Object.keys(next).length > 0 ? applyMvuPatch(tree, next) : tree;
}

/**
 * 将作者 MVU 树投影为梨园通用账本摘要。
 * 仅投影通用字段，作者树的其余结构原样留在 state.mvu 中供作者状态栏使用。
 */
export function projectMvuToWorldState(state: WorldState): WorldState {
	if (!state.mvu || typeof state.mvu !== "object") return state;
	const rawTime = scalarAt(state.mvu, [["坐标", "时间"], ["世界", "当前时间"], ["时间"]]);
	const stateTime = clockValue(state.time);
	const mvuTime = clockValue(rawTime);
	// 历史快照可能来自旧版本，曾把较早的 MVU 时间投影回顶层。以较晚值为准，
	// 并把修正后的时间回写到 MVU，避免状态栏下一次刷新再次回退。
	const effectiveTime = stateTime !== null && mvuTime !== null && stateTime > mvuTime ? state.time : rawTime;
	const tree = stateTime !== null && mvuTime !== null && stateTime > mvuTime ? applyMvuPatch(state.mvu, { "坐标.时间": effectiveTime }) : state.mvu;
	const coordinate = objectAt(tree, ["坐标"]) ?? objectAt(tree, ["世界"]);
	const time = scalarAt(tree, [["坐标", "时间"], ["世界", "当前时间"], ["时间"]]);
	const mode = scalarAt(tree, [["坐标", "当前状态"], ["世界", "当前地点"], ["地点"]]);
	const region = scalarAt(tree, [["坐标", "当前位置", "区域"]]);
	const facility = scalarAt(tree, [["坐标", "当前位置", "具体设施"]]);
	const locationParts = [mode, region, facility].filter(Boolean);
	const next: WorldState = {
		...state,
		time: time || state.time,
		location: locationParts.length > 0 ? locationParts.join(" ") : state.location,
	};

	const roster = objectAt(tree, ["在场角色列表"]);
	const profiles = objectAt(tree, ["角色列表"]);
	if (roster && profiles) {
		const characters: WorldState["characters"] = {};
		for (const [rawName, presence] of Object.entries(roster)) {
			if (!presence) continue;
			const baseName = rawName.replace(/【[^】]*】$/, "");
			const profile = profiles[rawName] ?? profiles[baseName];
			const p = profile && typeof profile === "object" && !Array.isArray(profile) ? (profile as Record<string, unknown>) : {};
			const affinityValue = p["好感度"] ?? p["好感"];
			characters[rawName] = {
				affinity: typeof affinityValue === "number" ? affinityValue : state.characters[rawName]?.affinity ?? 0,
				status: scalarAt(p, [["当前状态"], ["状态"], ["生命阶段"]]) || state.characters[rawName]?.status || "",
				notes: scalarAt(p, [["当前身份"], ["背景身份"]]) || state.characters[rawName]?.notes || "",
			};
		}
		if (Object.keys(characters).length > 0) next.characters = characters;
	}

	const assets = objectAt(tree, ["主角", "资产"]);
	const bag = assets ? objectAt(assets, ["背包内容", "存放物品"]) : null;
	const safe = assets ? objectAt(assets, ["保险箱内容", "存放物品"]) : null;
	const items: string[] = [];
	if (bag) {
		items.push(...Object.entries(bag).map(([name, value]) => {
			if (typeof value === "string" || typeof value === "number") return `${name} ×${value}`;
			return name;
		}));
	}
	if (safe) {
		items.push(...Object.keys(safe).map((name) => `${name}（保险箱内）`));
	}
	if (items.length > 0) next.inventory = [...new Set(items)];
	return next;
}
