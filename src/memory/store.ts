/**
 * 单库落盘：JSONL chunks + 简易暴力余弦检索
 * 路径：`.liyuan-memory/scopes/<card+session>/stores/<storeId>/chunks.jsonl`
 */

import { randomBytes } from "node:crypto";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { memoryRoot, memoryScopeRoot } from "./config.ts";
import { cosine, type EmbedContext, embedMany, embedOne } from "./embed.ts";
import type {
	MemoryChunk,
	MemoryChunkListItem,
	MemoryChunkMeta,
	MemoryScope,
	MemorySearchHit,
} from "./types.ts";
import { NARRATIVE_MERGE_MAX_CHARS } from "./types.ts";

function storeDir(cwd: string, scope: MemoryScope, storeId: string): string {
	return join(memoryScopeRoot(cwd, scope), "stores", storeId);
}

function chunksPath(cwd: string, scope: MemoryScope, storeId: string): string {
	return join(storeDir(cwd, scope, storeId), "chunks.jsonl");
}

const SHARD_SIZE = 256;

interface StoreManifest {
	version: 1;
	count: number;
	shards: Array<{ file: string; count: number; size: number; mtimeMs: number }>;
}

function manifestPath(cwd: string, scope: MemoryScope, storeId: string): string {
	return join(storeDir(cwd, scope, storeId), "manifest.json");
}

function atomicWrite(path: string, body: string): void {
	const temp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
	writeFileSync(temp, body, "utf8");
	renameSync(temp, path);
}

function readManifest(cwd: string, scope: MemoryScope, storeId: string): StoreManifest | null {
	const path = manifestPath(cwd, scope, storeId);
	if (!existsSync(path)) return null;
	try {
		const manifest = JSON.parse(readFileSync(path, "utf8")) as StoreManifest;
		if (manifest.version === 1 && Array.isArray(manifest.shards)) return manifest;
	} catch {
		/* rebuild/migrate below */
	}
	return null;
}

function shardFileName(index: number): string {
	return `chunks-${String(index).padStart(6, "0")}.jsonl`;
}

function writeShard(cwd: string, scope: MemoryScope, storeId: string, index: number, chunks: MemoryChunk[]): StoreManifest["shards"][number] {
	ensureStoreDir(cwd, scope, storeId);
	const file = shardFileName(index);
	const path = join(storeDir(cwd, scope, storeId), file);
	const body = chunks.map((chunk) => JSON.stringify(chunk)).join("\n") + (chunks.length ? "\n" : "");
	atomicWrite(path, body);
	const stat = statSync(path);
	return { file, count: chunks.length, size: stat.size, mtimeMs: stat.mtimeMs };
}

function writeManifest(cwd: string, scope: MemoryScope, storeId: string, manifest: StoreManifest): void {
	atomicWrite(manifestPath(cwd, scope, storeId), JSON.stringify(manifest));
}

function loadShard(cwd: string, scope: MemoryScope, storeId: string, file: string): MemoryChunk[] {
	const path = join(storeDir(cwd, scope, storeId), file);
	if (!existsSync(path)) return [];
	const chunks: MemoryChunk[] = [];
	for (const line of readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)) {
		try {
			const chunk = JSON.parse(line) as MemoryChunk;
			if (chunk?.id && chunk.text && Array.isArray(chunk.embedding)) chunks.push(chunk);
		} catch {
			throw new Error(`记忆分片损坏：${file}`);
		}
	}
	return chunks;
}

function ensureManifest(cwd: string, scope: MemoryScope, storeId: string): StoreManifest | null {
	const existing = readManifest(cwd, scope, storeId);
	if (existing) return existing;
	const legacy = chunksPath(cwd, scope, storeId);
	if (!existsSync(legacy)) return null;
	const chunks = loadLegacyChunks(cwd, scope, storeId);
	const shards: StoreManifest["shards"] = [];
	for (let i = 0; i < chunks.length; i += SHARD_SIZE) {
		shards.push(writeShard(cwd, scope, storeId, shards.length, chunks.slice(i, i + SHARD_SIZE)));
	}
	const manifest = { version: 1 as const, count: chunks.length, shards };
	writeManifest(cwd, scope, storeId, manifest);
	const backup = `${legacy}.legacy.bak`;
	if (!existsSync(backup)) copyFileSync(legacy, backup);
	unlinkSync(legacy);
	return manifest;
}

const writeQueues = new Map<string, Promise<void>>();

async function withStoreWrite<T>(cwd: string, scope: MemoryScope, storeId: string, run: () => Promise<T>): Promise<T> {
	const key = storeDir(cwd, scope, storeId);
	const previous = writeQueues.get(key) ?? Promise.resolve();
	let release!: () => void;
	const current = new Promise<void>((resolve) => { release = resolve; });
	const tail = previous.catch(() => undefined).then(() => current);
	writeQueues.set(key, tail);
	await previous.catch(() => undefined);
	const storesRoot = join(memoryScopeRoot(cwd, scope), "stores");
	if (!existsSync(storesRoot)) mkdirSync(storesRoot, { recursive: true });
	const lockPath = join(storesRoot, `.${storeId}.write.lock`);
	let lockFd: number | undefined;
	try {
		for (let attempt = 0; attempt < 200; attempt++) {
			try {
				lockFd = openSync(lockPath, "wx");
				break;
			} catch {
				if (existsSync(lockPath) && Date.now() - statSync(lockPath).mtimeMs > 120_000) unlinkSync(lockPath);
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
		}
		if (lockFd === undefined) throw new Error(`记忆库写锁超时：${storeId}`);
		return await run();
	} finally {
		if (lockFd !== undefined) closeSync(lockFd);
		if (existsSync(lockPath)) unlinkSync(lockPath);
		release();
		if (writeQueues.get(key) === tail) writeQueues.delete(key);
	}
}

const INDEX_VERSION = 2;
const INDEX_SEGMENT_SIZE = 100;

export interface MemoryStoreIndexItem {
	id: string;
	label: string;
	text: string;
	createdAt: string;
	segment: number;
	branchEntryId?: string;
	offset: number;
	length: number;
	file: string;
}

export interface MemoryStoreIndex {
	version: 2;
	manifestSize: number;
	manifestMtimeMs: number;
	count: number;
	segmentSize: number;
	items: MemoryStoreIndexItem[];
}

function indexPath(cwd: string, scope: MemoryScope, storeId: string): string {
	return join(storeDir(cwd, scope, storeId), "index.json");
}

function indexLabel(chunk: MemoryChunk): string {
	const title = chunk.meta.title || chunk.meta.fileName;
	const fallback = chunk.text.replace(/\s+/g, " ").trim().split(/(?<=[。！？!?；;])\s*/u)[0];
	return (title || fallback || "未命名记忆").trim().slice(0, 100);
}

function writeStoreIndex(cwd: string, scope: MemoryScope, storeId: string, chunks: MemoryChunk[]): void {
	const manifest = readManifest(cwd, scope, storeId);
	if (!manifest) return;
	const stat = statSync(manifestPath(cwd, scope, storeId));
	const shardOffsets = new Map<number, number>();
	const index: MemoryStoreIndex = {
		version: INDEX_VERSION,
		manifestSize: stat.size,
		manifestMtimeMs: stat.mtimeMs,
		count: chunks.length,
		segmentSize: INDEX_SEGMENT_SIZE,
		items: chunks.map((chunk, i) => {
			const shardIndex = Math.floor(i / SHARD_SIZE);
			const offset = shardOffsets.get(shardIndex) ?? 0;
			const length = Buffer.byteLength(JSON.stringify(chunk), "utf8");
			const item = {
				id: chunk.id,
				label: indexLabel(chunk),
				text: chunk.text.replace(/\s+/g, " ").trim().slice(0, 600),
				createdAt: chunk.meta.updatedAt || chunk.createdAt,
				segment: Math.floor(i / INDEX_SEGMENT_SIZE),
				branchEntryId: chunk.meta.branchEntryId,
				offset,
				length,
				file: manifest.shards[shardIndex]!.file,
			};
			shardOffsets.set(shardIndex, offset + length + 1);
			return item;
		}),
	};
	const target = indexPath(cwd, scope, storeId);
	const temp = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
	writeFileSync(temp, JSON.stringify(index), "utf8");
	renameSync(temp, target);
}

function loadChunksByIndex(cwd: string, scope: MemoryScope, storeId: string, items: MemoryStoreIndexItem[]): MemoryChunk[] {
	if (!items.length) return [];
	const chunks: MemoryChunk[] = [];
	const groups = new Map<string, MemoryStoreIndexItem[]>();
	for (const item of items) groups.set(item.file, [...(groups.get(item.file) ?? []), item]);
	for (const [file, fileItems] of groups) {
		const fd = openSync(join(storeDir(cwd, scope, storeId), file), "r");
		try {
			for (const item of fileItems) {
				const buffer = Buffer.allocUnsafe(item.length);
				const bytes = readSync(fd, buffer, 0, item.length, item.offset);
				if (bytes !== item.length) continue;
				try {
					const chunk = JSON.parse(buffer.toString("utf8")) as MemoryChunk;
					if (chunk.id === item.id) chunks.push(chunk);
				} catch {
					/* index will be rebuilt on the next metadata mismatch */
				}
			}
		} finally {
			closeSync(fd);
		}
	}
	return chunks;
}

/** 读取持久化目录；旧库、损坏目录或 JSONL 外部改动时自动重建。 */
export function loadStoreIndex(cwd: string, scope: MemoryScope, storeId: string): MemoryStoreIndex | null {
	const manifest = ensureManifest(cwd, scope, storeId);
	if (!manifest) return null;
	const indexFile = indexPath(cwd, scope, storeId);
	const stat = statSync(manifestPath(cwd, scope, storeId));
	if (existsSync(indexFile)) {
		try {
			const index = JSON.parse(readFileSync(indexFile, "utf8")) as MemoryStoreIndex;
			if (
				index.version === INDEX_VERSION &&
				index.manifestSize === stat.size &&
				Math.abs(index.manifestMtimeMs - stat.mtimeMs) < 1 &&
				Array.isArray(index.items) &&
				index.count === index.items.length
			) return index;
		} catch {
			/* rebuild below */
		}
	}
	const chunks = loadChunks(cwd, scope, storeId);
	writeStoreIndex(cwd, scope, storeId, chunks);
	return JSON.parse(readFileSync(indexFile, "utf8")) as MemoryStoreIndex;
}

export function ensureStoreDir(cwd: string, scope: MemoryScope, storeId: string): void {
	const d = storeDir(cwd, scope, storeId);
	if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function loadLegacyChunks(cwd: string, scope: MemoryScope, storeId: string): MemoryChunk[] {
	const p = chunksPath(cwd, scope, storeId);
	if (!existsSync(p)) return [];
	const lines = readFileSync(p, "utf8").split(/\r?\n/).filter(Boolean);
	const out: MemoryChunk[] = [];
	for (const [lineIndex, line] of lines.entries()) {
		try {
			const c = JSON.parse(line) as MemoryChunk;
			if (c?.id && c.text && Array.isArray(c.embedding)) out.push(c);
		} catch {
			throw new Error(`旧记忆库第 ${lineIndex + 1} 行损坏，已保留原文件并中止迁移`);
		}
	}
	return out;
}

export function loadChunks(cwd: string, scope: MemoryScope, storeId: string): MemoryChunk[] {
	const manifest = ensureManifest(cwd, scope, storeId);
	if (!manifest) return [];
	return manifest.shards.flatMap((shard) => loadShard(cwd, scope, storeId, shard.file));
}

function persistChunks(
	cwd: string,
	scope: MemoryScope,
	storeId: string,
	chunks: MemoryChunk[],
): void {
	ensureStoreDir(cwd, scope, storeId);
	const old = readManifest(cwd, scope, storeId);
	const shards: StoreManifest["shards"] = [];
	for (let i = 0; i < chunks.length; i += SHARD_SIZE) {
		const shardIndex = shards.length;
		const nextChunks = chunks.slice(i, i + SHARD_SIZE);
		const oldShard = old?.shards[shardIndex];
		const oldChunks = oldShard ? loadShard(cwd, scope, storeId, oldShard.file) : [];
		if (oldShard && JSON.stringify(oldChunks) === JSON.stringify(nextChunks)) shards.push(oldShard);
		else shards.push(writeShard(cwd, scope, storeId, shardIndex, nextChunks));
	}
	writeManifest(cwd, scope, storeId, { version: 1, count: chunks.length, shards });
	for (const stale of old?.shards.slice(shards.length) ?? []) {
		const path = join(storeDir(cwd, scope, storeId), stale.file);
		if (existsSync(path)) unlinkSync(path);
	}
	writeStoreIndex(cwd, scope, storeId, chunks);
}

export function countChunks(cwd: string, scope: MemoryScope, storeId: string): number {
	return ensureManifest(cwd, scope, storeId)?.count ?? 0;
}

export async function clearStore(cwd: string, scope: MemoryScope, storeId: string): Promise<void> {
	await withStoreWrite(cwd, scope, storeId, async () => {
		const d = storeDir(cwd, scope, storeId);
		if (existsSync(d)) rmSync(d, { recursive: true, force: true });
	});
}

export async function deleteStoreFiles(cwd: string, scope: MemoryScope, storeId: string): Promise<void> {
	await clearStore(cwd, scope, storeId);
}

/** 切块：按段落/长度 */
export function splitTextChunks(text: string, maxLen = 480): string[] {
	const t = text.replace(/\r\n/g, "\n").trim();
	if (!t) return [];
	const paras = t
		.split(/\n{2,}/)
		.map((p) => p.trim())
		.filter(Boolean);
	const out: string[] = [];
	let buf = "";
	const flush = () => {
		if (buf.trim()) out.push(buf.trim());
		buf = "";
	};
	for (const p of paras.length ? paras : [t]) {
		if (p.length <= maxLen) {
			if ((buf + "\n\n" + p).length > maxLen) {
				flush();
				buf = p;
			} else {
				buf = buf ? `${buf}\n\n${p}` : p;
			}
			continue;
		}
		flush();
		for (let i = 0; i < p.length; i += maxLen) out.push(p.slice(i, i + maxLen));
	}
	flush();
	return out;
}

export async function upsertTexts(
	cwd: string,
	scope: MemoryScope,
	storeId: string,
	texts: string[],
	meta: MemoryChunkMeta,
	maxChunks: number,
	embedCtx: EmbedContext,
): Promise<{ added: number; total: number }> {
	return withStoreWrite(cwd, scope, storeId, async () => {
		const index = loadStoreIndex(cwd, scope, storeId);
		const existingText = new Set((index?.items ?? []).map((item) => item.text));
		const now = new Date().toISOString();
		const incoming = new Set<string>();
		const toAdd = texts
			.map((t) => t.trim().slice(0, 4000))
			.filter((t) => t.length >= 8 && !existingText.has(t.slice(0, 600)) && !incoming.has(t) && !!incoming.add(t));
		if (!toAdd.length) return { added: 0, total: index?.count ?? 0 };
		const retained = toAdd.slice(-Math.max(1, maxChunks));
		const vectors = await embedMany(retained, embedCtx);
		const mode = embedCtx.mode;
		const model = mode === "cloud" ? embedCtx.cloud.model : "local-hash-v1";
		const additions: MemoryChunk[] = [];
		for (let i = 0; i < retained.length; i++) additions.push({
			id: randomBytes(8).toString("hex"),
			text: retained[i]!,
			embedding: vectors[i]!,
			meta: {
				...meta,
				sessionId: scope.sessionId,
				card: scope.card,
				embedMode: mode,
				embedModel: model,
			},
			createdAt: now,
		});
		const manifest = ensureManifest(cwd, scope, storeId);
		let chunks: MemoryChunk[];
		if (!manifest || (manifest.count + additions.length > maxChunks)) {
			chunks = [...loadChunks(cwd, scope, storeId), ...additions].slice(-maxChunks);
		} else {
			const lastShard = manifest.shards.at(-1);
			const prefixCount = lastShard ? manifest.count - lastShard.count : 0;
			const prefixItems = (index?.items ?? []).slice(0, prefixCount);
			const prefixChunks = loadChunksByIndex(cwd, scope, storeId, prefixItems);
			const tail = lastShard ? loadShard(cwd, scope, storeId, lastShard.file) : [];
			chunks = [...prefixChunks, ...tail, ...additions];
		}
		persistChunks(cwd, scope, storeId, chunks);
		return { added: retained.length, total: chunks.length };
	});
}

/** fork/迁移用：保留完整元数据与向量，按 id/正文去重。 */
export async function importChunks(
	cwd: string,
	scope: MemoryScope,
	storeId: string,
	incoming: MemoryChunk[],
	maxChunks: number,
): Promise<void> {
	await withStoreWrite(cwd, scope, storeId, async () => {
		const chunks = loadChunks(cwd, scope, storeId);
		const ids = new Set(chunks.map((chunk) => chunk.id));
		const texts = new Set(chunks.map((chunk) => chunk.text));
		for (const chunk of incoming) {
			if (ids.has(chunk.id) || texts.has(chunk.text)) continue;
			chunks.push(structuredClone(chunk));
			ids.add(chunk.id);
			texts.add(chunk.text);
		}
		const limit = Math.max(1, Math.floor(maxChunks) || 1);
		if (chunks.length > limit) chunks.splice(0, chunks.length - limit);
		if (chunks.length) persistChunks(cwd, scope, storeId, chunks);
	});
}

/** 列表条目（不含 embedding） */
export function listChunks(
	cwd: string,
	scope: MemoryScope,
	storeId: string,
): MemoryChunkListItem[] {
	return loadChunks(cwd, scope, storeId).map((c) => ({
		id: c.id,
		text: c.text,
		textLen: c.text.length,
		meta: c.meta,
		createdAt: c.createdAt,
	}));
}

/** 按 id 删除单条；返回是否删到 */
export async function deleteChunkById(
	cwd: string,
	scope: MemoryScope,
	storeId: string,
	chunkId: string,
): Promise<boolean> {
	return withStoreWrite(cwd, scope, storeId, async () => {
		const id = chunkId.trim();
		if (!id) return false;
		const chunks = loadChunks(cwd, scope, storeId);
		const next = chunks.filter((c) => c.id !== id);
		if (next.length === chunks.length) return false;
		if (next.length === 0) {
			const d = storeDir(cwd, scope, storeId);
			if (existsSync(d)) rmSync(d, { recursive: true, force: true });
			return true;
		}
		persistChunks(cwd, scope, storeId, next);
		return true;
	});
}

/**
 * 剧情库合并入库：优先并入**最后一条**（未超字数上限则合并并重 embed）；
 * 否则新开一条。禁止产生「每轮一条」的爆炸条数。
 */
export async function mergeNarrativeText(
	cwd: string,
	scope: MemoryScope,
	text: string,
	meta: MemoryChunkMeta,
	maxChunks: number,
	embedCtx: EmbedContext,
	maxEntryChars = NARRATIVE_MERGE_MAX_CHARS,
): Promise<{ merged: boolean; added: number; total: number; id: string; noop?: boolean }> {
	return withStoreWrite(cwd, scope, "narrative", async () => {
	const summary = text.trim();
	if (summary.length < 8) {
		return { merged: false, added: 0, total: countChunks(cwd, scope, "narrative"), id: "", noop: true };
	}
	const body = summary.slice(0, 4000);
	const chunks = loadChunks(cwd, scope, "narrative");
	const now = new Date().toISOString();
	const mode = embedCtx.mode;
	const model = mode === "cloud" ? embedCtx.cloud.model : "local-hash-v1";
	const last = chunks.length ? chunks[chunks.length - 1]! : null;

	// 完全相同则跳过
	if (last && last.text === body) {
		return { merged: true, added: 0, total: chunks.length, id: last.id, noop: true };
	}
	// 已包含本次摘要开头 → 视为重复
	if (last && body.length >= 24 && last.text.includes(body.slice(0, Math.min(80, body.length)))) {
		return { merged: true, added: 0, total: chunks.length, id: last.id, noop: true };
	}

	const canMerge =
		!!last &&
		last.meta.source === "narrative" &&
		last.meta.branchEntryId === meta.branchEntryId &&
		`${last.text}\n\n${body}`.length <= Math.max(400, maxEntryChars);

	if (canMerge && last) {
		const mergedText = `${last.text}\n\n${body}`;
		const emb = await embedOne(mergedText, embedCtx);
		last.text = mergedText;
		last.embedding = emb;
		last.meta = {
			...last.meta,
			...meta,
			sessionId: scope.sessionId,
			card: scope.card,
			source: "narrative",
			embedMode: mode,
			embedModel: model,
			mergeCount: (last.meta.mergeCount ?? 1) + 1,
			updatedAt: now,
		};
		persistChunks(cwd, scope, "narrative", chunks);
		return { merged: true, added: 0, total: chunks.length, id: last.id };
	}

	const emb = await embedOne(body, embedCtx);
	const id = randomBytes(8).toString("hex");
	chunks.push({
		id,
		text: body,
		embedding: emb,
		meta: {
			...meta,
			sessionId: scope.sessionId,
			card: scope.card,
			source: "narrative",
			embedMode: mode,
			embedModel: model,
			mergeCount: 1,
			updatedAt: now,
		},
		createdAt: now,
	});
	while (chunks.length > maxChunks) chunks.shift();
	persistChunks(cwd, scope, "narrative", chunks);
	return { merged: false, added: 1, total: chunks.length, id };
	});
}

/**
 * 保留原文，用当前 embed 模式重算本库全部向量（换 local/cloud 时用，不重写剧情）。
 * 云端按 batchSize 分批调用 embeddings。
 */
export async function reembedStore(
	cwd: string,
	scope: MemoryScope,
	storeId: string,
	embedCtx: EmbedContext,
	batchSize = 32,
): Promise<{ total: number; updated: number; skipped: number }> {
	return withStoreWrite(cwd, scope, storeId, async () => {
	const chunks = loadChunks(cwd, scope, storeId);
	if (!chunks.length) return { total: 0, updated: 0, skipped: 0 };

	const mode = embedCtx.mode;
	const model = mode === "cloud" ? embedCtx.cloud.model : "local-hash-v1";
	const size = Math.max(1, Math.min(64, Math.floor(batchSize) || 32));
	let updated = 0;
	let skipped = 0;

	for (let i = 0; i < chunks.length; i += size) {
		const batch = chunks.slice(i, i + size);
		const texts = batch.map((c) => c.text);
		const vectors = await embedMany(texts, embedCtx);
		for (let j = 0; j < batch.length; j++) {
			const c = batch[j]!;
			const v = vectors[j];
			if (!v?.length) {
				skipped++;
				continue;
			}
			c.embedding = v;
			c.meta = { ...c.meta, embedMode: mode, embedModel: model };
			updated++;
		}
	}
	persistChunks(cwd, scope, storeId, chunks);
	return { total: chunks.length, updated, skipped };
	});
}

export async function searchStore(
	cwd: string,
	scope: MemoryScope,
	storeId: string,
	query: string,
	topK: number,
	embedCtx: EmbedContext,
): Promise<MemorySearchHit[]> {
	const q = query.trim();
	if (!q) return [];
	const [qe] = await embedMany([q], embedCtx);
	if (!qe) return [];
	const visible = scope.branchEntryIds?.length ? new Set(scope.branchEntryIds) : null;
	const index = loadStoreIndex(cwd, scope, storeId);
	const terms = q.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
	const visibleItems = (index?.items ?? []).filter(
		(item) => !item.branchEntryId || !visible || visible.has(item.branchEntryId),
	);
	let candidateIds = new Set(
		visibleItems
			.filter((item) => terms.some((term) => item.text.toLowerCase().includes(term)))
			.map((item) => item.id),
	);
	if (!candidateIds.size && visibleItems.length) {
		const sampleLimit = 2000;
		const step = Math.max(1, Math.ceil(visibleItems.length / sampleLimit));
		candidateIds = new Set(visibleItems.filter((_, i) => i % step === 0 || i >= visibleItems.length - 100).map((item) => item.id));
	}
	const candidateItems = visibleItems.filter((item) => !candidateIds.size || candidateIds.has(item.id));
	const chunks = loadChunksByIndex(cwd, scope, storeId, candidateItems);
	// 过滤与当前模式维度明显不兼容的旧块（长度差太大）
	const dim = qe.length;
	const expectedMode = embedCtx.mode;
	const expectedModel = expectedMode === "cloud" ? embedCtx.cloud.model : "local-hash-v1";
	const scored = chunks
		.filter((c) => c.embedding.length === dim)
		.filter((c) => !c.meta.embedMode || (c.meta.embedMode === expectedMode && c.meta.embedModel === expectedModel))
		.map((c) => ({
			id: c.id,
			text: c.text,
			score: cosine(qe, c.embedding),
			meta: c.meta,
			createdAt: c.createdAt,
		}))
		.filter((h) => h.score > 0.05)
		.sort((a, b) => b.score - a.score)
		.slice(0, Math.min(100, Math.max(1, Number.isFinite(topK) ? Math.floor(topK) : 5)));
	return scored;
}

export function listStoreIdsOnDisk(cwd: string, scope: MemoryScope): string[] {
	const root = join(memoryScopeRoot(cwd, scope), "stores");
	if (!existsSync(root)) return [];
	return readdirSync(root, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name);
}

/** 列出磁盘上所有 scope 目录名（调试/清理用） */
export function listScopeIdsOnDisk(cwd: string): string[] {
	const root = join(memoryRoot(cwd), "scopes");
	if (!existsSync(root)) return [];
	return readdirSync(root, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name);
}
