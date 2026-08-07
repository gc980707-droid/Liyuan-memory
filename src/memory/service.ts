/**
 * 记忆服务门面：
 *  - 剧情库 narrative：仅 agent 合并入库
 *  - 额外库 external：导入 + 手动向量化（条目可删）
 * 读写一律带 MemoryScope（角色卡 + 会话）
 */

import { memoryScopeId, loadMemoryConfig, patchMemoryConfig, publicMemoryConfig, saveMemoryConfig } from "./config.ts";
import type { EmbedContext } from "./embed.ts";
import {
	clearStore,
	countChunks,
	deleteChunkById,
	deleteStoreFiles,
	importChunks,
	loadStoreIndex,
	listChunks,
	mergeNarrativeText,
	reembedStore,
	searchStore,
	splitTextChunks,
	upsertTexts,
} from "./store.ts";
import type {
	MemoryChunkListItem,
	MemoryChunkMeta,
	MemoryConfig,
	MemoryScope,
	MemorySearchHit,
	MemoryStoreConfig,
	MemoryStoreStats,
} from "./types.ts";
import { DEFAULT_MEMORY_CONFIG } from "./types.ts";

const memoryWriteQueues = new Map<string, Promise<unknown>>();

function enqueueMemoryWrite<T>(key: string, task: () => Promise<T>): Promise<T> {
	const previous = memoryWriteQueues.get(key) ?? Promise.resolve();
	const next = previous.then(task, task);
	memoryWriteQueues.set(key, next.finally(() => {
		if (memoryWriteQueues.get(key) === next) memoryWriteQueues.delete(key);
	}));
	return next;
}

function embedCtxFrom(cfg: MemoryConfig): EmbedContext {
	return { mode: cfg.embedMode, cloud: cfg.cloudEmbed };
}

function normalizeScope(scope: MemoryScope | undefined): MemoryScope {
	return {
		sessionId: (scope?.sessionId || "_default").trim() || "_default",
		card: scope?.card?.trim() || undefined,
		leafId: scope?.leafId?.trim() || undefined,
		branchEntryIds: scope?.branchEntryIds?.filter(Boolean),
	};
}

function assertExtraStore(storeId: string): void {
	if (storeId === "narrative") {
		throw new Error("剧情数据库仅由 agent 自动合并写入，不能手动导入/添加");
	}
}

export function getMemoryStatus(
	cwd: string,
	scope?: MemoryScope,
): {
	config: ReturnType<typeof publicMemoryConfig>;
	stores: MemoryStoreStats[];
	/** 当前作用域（设置面板展示：本对话的库） */
	scope: { sessionId: string; card?: string; scopeId: string };
} {
	const sc = normalizeScope(scope);
	const config = loadMemoryConfig(cwd);
	const stores: MemoryStoreStats[] = config.stores.map((s) => ({
		id: s.id,
		name: s.name,
		kind: s.kind,
		enabled: s.enabled,
		everyNTurns: s.everyNTurns,
		chunkCount: countChunks(cwd, sc, s.id),
		maxChunks: s.maxChunks,
	}));
	return {
		config: publicMemoryConfig(config),
		stores,
		scope: {
			sessionId: sc.sessionId,
			card: sc.card,
			scopeId: memoryScopeId(sc),
		},
	};
}

/**
 * 分层常驻目录：总览按时间分段，保证再旧的历史也有入口；与本轮相关的条目另行展开。
 * 数据直接从 JSONL 派生，旧记忆无需迁移。
 */
export async function formatMemoryIndex(
	cwd: string,
	scope: MemoryScope,
	query = "",
	opts?: { maxChars?: number; segmentSize?: number; relevantItems?: number },
): Promise<string | null> {
	const cfg = loadMemoryConfig(cwd);
	if (!cfg.enabled) return null;
	const sc = normalizeScope(scope);
	const maxChars = Math.max(800, opts?.maxChars ?? 7000);
	const segmentSize = Math.max(20, opts?.segmentSize ?? 100);
	const relevantItems = Math.max(1, opts?.relevantItems ?? 12);
	const overview: string[] = [];
	const candidates: Array<{ line: string; text: string; createdAt: string; segment: number }> = [];

	for (const store of cfg.stores) {
		if (!store.enabled) continue;
		const index = loadStoreIndex(cwd, sc, store.id);
		if (!index?.items.length) continue;
		const visible = sc.branchEntryIds?.length ? new Set(sc.branchEntryIds) : null;
		const items = index.items.filter((item) => !item.branchEntryId || !visible || visible.has(item.branchEntryId));
		if (!items.length) continue;
		for (let start = 0; start < items.length; start += segmentSize) {
			const segment = items.slice(start, start + segmentSize);
			const first = segment[0]!;
			const last = segment[segment.length - 1]!;
			const from = start + 1;
			const to = start + segment.length;
			const head = first.label.slice(0, 44);
			const tail = last.label.slice(0, 44);
			overview.push(`- ${store.name} ${from}-${to}/${items.length}：${head}${head === tail ? "" : ` → ${tail}`}`);
		}
		for (const item of items) {
			candidates.push({
				line: `- [${store.name}:${item.id.slice(0, 8)}] ${item.label.slice(0, store.kind === "narrative" ? 100 : 80)}`,
				text: item.text,
				createdAt: item.createdAt,
				segment: item.segment,
			});
		}
	}

	if (!candidates.length) return null;
	let expanded = [...candidates]
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		.slice(0, relevantItems)
		.map((item) => item.line);
	const q = query.trim();
	if (q.length >= 2) {
		const terms = q.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
		expanded = candidates
			.map((item) => ({
				line: item.line,
				score: terms.reduce((score, term) => score + (item.text.toLowerCase().includes(term) ? term.length : 0), 0),
			}))
			.filter((item) => item.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, relevantItems)
			.map((item) => item.line);
	}

	const sections = [`分段总览（${candidates.length} 条；每段 ${segmentSize} 条）：`, ...overview];
	if (expanded.length) sections.push("本轮相关条目：", ...expanded);
	let result = sections.join("\n");
	if (result.length > maxChars) {
		const keepExpanded = expanded.length ? `\n本轮相关条目：\n${expanded.join("\n")}` : "";
		const budget = Math.max(400, maxChars - keepExpanded.length - 80);
		const maxLines = Math.max(2, Math.floor(budget / 90));
		const sampled = overview.length <= maxLines
			? overview
			: Array.from({ length: maxLines }, (_, i) => overview[Math.round(i * (overview.length - 1) / (maxLines - 1))]!);
		result = `分段总览（${candidates.length} 条；超长时等距保留全历史入口）：\n${sampled.join("\n")}${keepExpanded}`;
	}
	return result.slice(0, maxChars);
}

export function updateMemoryConfig(cwd: string, patch: Partial<MemoryConfig>): MemoryConfig {
	// apiKey 若前端回传掩码则不覆盖
	if (patch.cloudEmbed?.apiKey === "••••••••" || patch.cloudEmbed?.apiKey === "********") {
		const cur = loadMemoryConfig(cwd);
		patch = {
			...patch,
			cloudEmbed: { ...patch.cloudEmbed, apiKey: cur.cloudEmbed.apiKey },
		};
	}
	return patchMemoryConfig(cwd, patch);
}

export function updateStoreConfig(
	cwd: string,
	storeId: string,
	patch: Partial<MemoryStoreConfig>,
): MemoryConfig {
	const cfg = loadMemoryConfig(cwd);
	const stores = cfg.stores.map((s) => (s.id === storeId ? { ...s, ...patch, id: s.id } : s));
	return saveMemoryConfig(cwd, { ...cfg, stores });
}

export async function memorySearch(
	cwd: string,
	scope: MemoryScope,
	storeId: string,
	query: string,
	topK?: number,
): Promise<MemorySearchHit[]> {
	const cfg = loadMemoryConfig(cwd);
	if (!cfg.enabled) return [];
	const store = cfg.stores.find((s) => s.id === storeId);
	if (!store?.enabled) return [];
	const sc = normalizeScope(scope);
	return searchStore(cwd, sc, storeId, query, topK ?? cfg.searchTopK, embedCtxFrom(cfg));
}

/** 列出条目（无 embedding），供管理 UI */
export function memoryListChunks(
	cwd: string,
	scope: MemoryScope,
	storeId: string,
): MemoryChunkListItem[] {
	const cfg = loadMemoryConfig(cwd);
	const store = cfg.stores.find((s) => s.id === storeId);
	if (!store) throw new Error(`库不存在：${storeId}`);
	const sc = normalizeScope(scope);
	const visible = sc.branchEntryIds?.length ? new Set(sc.branchEntryIds) : null;
	return listChunks(cwd, sc, storeId).filter(
		(chunk) => !chunk.meta.branchEntryId || !visible || visible.has(chunk.meta.branchEntryId),
	);
}

/** 删除单条 */
export async function memoryDeleteChunk(
	cwd: string,
	scope: MemoryScope,
	storeId: string,
	chunkId: string,
): Promise<boolean> {
	const cfg = loadMemoryConfig(cwd);
	const store = cfg.stores.find((s) => s.id === storeId);
	if (!store) throw new Error(`库不存在：${storeId}`);
	const sc = normalizeScope(scope);
	const visible = memoryListChunks(cwd, sc, storeId).some((chunk) => chunk.id === chunkId);
	if (!visible) return false;
	return deleteChunkById(cwd, sc, storeId, chunkId);
}

/**
 * 额外库：手动向量化一条（不切碎长文以外的特殊逻辑；过长按块切，每块一条）。
 * 禁止写入剧情库。
 */
export async function memoryManualAdd(
	cwd: string,
	scope: MemoryScope,
	text: string,
	opts?: { title?: string; storeId?: string },
): Promise<{ added: number; total: number; chunks: number }> {
	const storeId = (opts?.storeId || "external").trim() || "external";
	assertExtraStore(storeId);
	const cfg = loadMemoryConfig(cwd);
	if (!cfg.enabled) throw new Error("请先启用向量记忆");
	const store = cfg.stores.find((s) => s.id === storeId);
	if (!store?.enabled) throw new Error(`库未启用：${store.name || storeId}`);
	const sc = normalizeScope(scope);
	const raw = text.trim();
	if (raw.length < 8) throw new Error("内容太短（至少约 8 字）");
	// 短文整条；长文切块，每块一个条目
	const parts = raw.length <= 800 ? [raw.slice(0, 4000)] : splitTextChunks(raw, 600);
	const r = await upsertTexts(
		cwd,
		sc,
		storeId,
		parts,
			{
				source: "manual",
				title: opts?.title?.trim() || undefined,
				branchEntryId: sc.leafId,
		},
		store.maxChunks,
		embedCtxFrom(cfg),
	);
	return { ...r, chunks: parts.length };
}

export async function memoryImportText(
	cwd: string,
	scope: MemoryScope,
	storeId: string,
	text: string,
	fileName?: string,
): Promise<{ added: number; total: number; chunks: number }> {
	assertExtraStore(storeId);
	const cfg = loadMemoryConfig(cwd);
	if (!cfg.enabled) return { added: 0, total: 0, chunks: 0 };
	const store = cfg.stores.find((s) => s.id === storeId);
	if (!store?.enabled) return { added: 0, total: 0, chunks: 0 };
	const sc = normalizeScope(scope);
	const parts = splitTextChunks(text, 600);
	const r = await upsertTexts(
		cwd,
		sc,
		storeId,
		parts,
		{ source: "import", fileName, title: fileName, branchEntryId: sc.leafId },
		store.maxChunks,
		embedCtxFrom(cfg),
	);
	return { ...r, chunks: parts.length };
}

/** fork 新会话继承父会话当前祖先链可见的记忆；目标已存在时按正文去重。 */
export async function inheritMemoryScope(
	cwd: string,
	from: MemoryScope,
	to: MemoryScope,
): Promise<void> {
	const cfg = loadMemoryConfig(cwd);
	const visible = to.branchEntryIds?.length ? new Set(to.branchEntryIds) : null;
	for (const store of cfg.stores) {
		const inherited = listChunks(cwd, normalizeScope(from), store.id).filter(
			(chunk) => !chunk.meta.branchEntryId || !visible || visible.has(chunk.meta.branchEntryId),
		);
		if (!inherited.length) continue;
		await importChunks(cwd, normalizeScope(to), store.id, inherited, store.maxChunks);
	}
}

export async function memoryClearStore(cwd: string, scope: MemoryScope, storeId: string): Promise<void> {
	await clearStore(cwd, normalizeScope(scope), storeId);
}

/** 删除自定义库配置 + 文件；内置 narrative/external 仅清空当前作用域 */
export async function memoryRemoveStore(
	cwd: string,
	scope: MemoryScope,
	storeId: string,
): Promise<MemoryConfig> {
	const cfg = loadMemoryConfig(cwd);
	const store = cfg.stores.find((s) => s.id === storeId);
	if (!store) return cfg;
	const sc = normalizeScope(scope);
	if (store.kind === "narrative" || store.kind === "external") {
		await clearStore(cwd, sc, storeId);
		return cfg;
	}
	await deleteStoreFiles(cwd, sc, storeId);
	return saveMemoryConfig(cwd, {
		...cfg,
		stores: cfg.stores.filter((s) => s.id !== storeId),
	});
}

/**
 * 叙事轮结束：按 everyNTurns **合并**写入剧情库（仅 agent 路径）。
 */
export async function onNarrativeTurnEnd(
	cwd: string,
	scope: MemoryScope,
	assistantText: string,
): Promise<{
	stored: boolean;
	merged?: boolean;
	counter: number;
	added?: number;
	error?: string;
	noop?: boolean;
}> {
	return enqueueMemoryWrite(cwd, async () => {
	const cfg = loadMemoryConfig(cwd);
	if (!cfg.enabled) return { stored: false, counter: 0 };
	const store = cfg.stores.find((s) => s.id === "narrative" && s.enabled);
	if (!store || store.everyNTurns <= 0) return { stored: false, counter: 0 };

	const sc = normalizeScope(scope);
	const key = memoryScopeId(sc);
	const counters = { ...(cfg.turnCounters ?? {}) };
	const next = (counters[key] ?? 0) + 1;
	counters[key] = next;
	saveMemoryConfig(cwd, { ...cfg, turnCounters: counters });

	if (next % store.everyNTurns !== 0) {
		return { stored: false, counter: next };
	}
	const text = assistantText.trim();
	if (text.length < 20) return { stored: false, counter: next };

	const summary = text.length > 1200 ? `${text.slice(0, 600)}\n…\n${text.slice(-400)}` : text;
	try {
		const r = await mergeNarrativeText(
			cwd,
			sc,
			summary,
			{ source: "narrative", sessionId: sc.sessionId, card: sc.card, branchEntryId: sc.leafId },
			store.maxChunks,
			embedCtxFrom(cfg),
		);
		if (r.noop) return { stored: false, counter: next, noop: true, merged: r.merged };
		return {
			stored: true,
			merged: r.merged,
			counter: next,
			added: r.added,
		};
	} catch (e) {
		return { stored: false, counter: next, error: e instanceof Error ? e.message : String(e) };
	}
	});
}

export function defaultMemoryConfig(): MemoryConfig {
	return structuredClone(DEFAULT_MEMORY_CONFIG);
}

/**
 * 剧情回合检索：仅搜**当前卡+当前对话**已启用库，供 buildTurnInjection 注入。
 */
export async function memoryRecallForTurn(
	cwd: string,
	scope: MemoryScope,
	query: string,
): Promise<MemorySearchHit[]> {
	const cfg = loadMemoryConfig(cwd);
	if (!cfg.enabled || !cfg.injectOnTurn) return [];
	const q = query.trim();
	if (q.length < 2) return [];
	const sc = normalizeScope(scope);
	const ctx = embedCtxFrom(cfg);
	const merged: MemorySearchHit[] = [];
	for (const s of cfg.stores) {
		if (!s.enabled) continue;
		try {
			const hits = await searchStore(cwd, sc, s.id, q, cfg.searchTopK, ctx);
			for (const h of hits) {
				merged.push({
					...h,
					meta: { ...h.meta, title: h.meta.title || s.name },
				});
			}
		} catch (e) {
			console.warn("[memory] search store failed", s.id, e);
		}
	}
	merged.sort((a, b) => b.score - a.score);
	const out: MemorySearchHit[] = [];
	for (const h of merged) {
		if (out.some((x) => x.text.slice(0, 80) === h.text.slice(0, 80))) continue;
		out.push(h);
		if (out.length >= cfg.searchTopK) break;
	}
	return out;
}

/** 探测云端 embedding 是否可用 */
export async function probeCloudEmbed(cwd: string): Promise<{ ok: boolean; dim?: number; error?: string }> {
	const cfg = loadMemoryConfig(cwd);
	try {
		const { embedTextsCloud } = await import("./embed.ts");
		const vecs = await embedTextsCloud(["梨园记忆探测"], cfg.cloudEmbed);
		return { ok: true, dim: vecs[0]?.length };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

export type MemoryReembedResult = {
	mode: "local" | "cloud";
	model: string;
	stores: Array<{ storeId: string; name: string; total: number; updated: number; skipped: number }>;
	totalUpdated: number;
	totalChunks: number;
};

/**
 * 用**当前** embed 模式，对本对话全部（或指定）库的已有正文重算向量。
 * 不删文本、不调聊天模型；云端只花 embedding 费用。
 */
export async function memoryReembedScope(
	cwd: string,
	scope: MemoryScope,
	opts?: { storeId?: string },
): Promise<MemoryReembedResult> {
	const cfg = loadMemoryConfig(cwd);
	if (!cfg.enabled) throw new Error("请先启用向量记忆");
	const sc = normalizeScope(scope);
	const ctx = embedCtxFrom(cfg);
	const model = ctx.mode === "cloud" ? ctx.cloud.model || "cloud" : "local-hash-v1";
	if (ctx.mode === "cloud") {
		const base = (ctx.cloud.baseUrl || "").trim();
		const key = (ctx.cloud.apiKey || "").trim();
		const m = (ctx.cloud.model || "").trim();
		if (!base || !key || !m) throw new Error("云端 embedding 未配置完整（Base URL / API Key / 模型）");
	}

	const targets = opts?.storeId
		? cfg.stores.filter((s) => s.id === opts.storeId)
		: cfg.stores;
	if (!targets.length) throw new Error(opts?.storeId ? `库不存在：${opts.storeId}` : "无可用库");

	const stores: MemoryReembedResult["stores"] = [];
	let totalUpdated = 0;
	let totalChunks = 0;
	for (const s of targets) {
		const r = await reembedStore(cwd, sc, s.id, ctx);
		stores.push({
			storeId: s.id,
			name: s.name,
			total: r.total,
			updated: r.updated,
			skipped: r.skipped,
		});
		totalUpdated += r.updated;
		totalChunks += r.total;
	}
	return { mode: ctx.mode, model, stores, totalUpdated, totalChunks };
}
