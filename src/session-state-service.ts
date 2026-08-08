import type { MvuData, MvuOperation } from "./mvu.ts";
import { applyMvuOperations, loadMvuData, saveMvuData } from "./mvu.ts";
import { applyPatch, canonicalizeCharacterKeys, loadState, saveState, type PatchResult } from "./state.ts";
import type { WorldState } from "./types.ts";

export type StateWriteSource = "rest" | "assistant" | "roleplay-tool" | "scribe" | "mvu-parser" | "side-agent" | "session-tree" | "init";
export type StateWriteMeta = { source: StateWriteSource; turn?: number; branchId?: string };

export interface SessionStateServiceOptions {
	stateFile: string;
	mvuFile: string;
	knownCharacterNames?: () => string[];
	snapshotState?: () => void;
	snapshotMvu?: () => void;
}

/** Harness 状态提交层：业务只能提交 patch，落盘/快照在此统一完成。 */
export class SessionStateService {
	private state: WorldState;
	private mvu: MvuData;
	private readonly options: SessionStateServiceOptions;
	private queue: Promise<unknown> = Promise.resolve();

	constructor(options: SessionStateServiceOptions) {
		this.options = options;
		this.state = loadState(options.stateFile);
		this.mvu = loadMvuData(options.mvuFile);
	}

	getWorldState(): WorldState { return structuredClone(this.state); }
	getMvu(): MvuData { return structuredClone(this.mvu); }

	patchWorldState(patch: Record<string, unknown>, meta: StateWriteMeta): Promise<PatchResult> {
		return this.enqueue(() => {
			const known = this.options.knownCharacterNames?.() ?? Object.keys(this.state.characters);
			const normalized = canonicalizeCharacterKeys(patch, known);
			const result = applyPatch(this.state, normalized);
			if (result.applied.length) {
				this.state = result.state;
				saveState(this.options.stateFile, this.state);
				this.options.snapshotState?.();
			}
			void meta;
			return result;
		});
	}

	patchMvu(operations: MvuOperation[], meta: StateWriteMeta): Promise<ReturnType<typeof applyMvuOperations>> {
		return this.enqueue(() => {
			const result = applyMvuOperations(this.mvu, operations, { atomic: true });
			if (result.applied.length) {
				this.mvu = result.data;
				saveMvuData(this.options.mvuFile, this.mvu);
				this.options.snapshotMvu?.();
			}
			void meta;
			return result;
		});
	}

	replaceWorldState(state: WorldState, meta: StateWriteMeta): Promise<void> {
		return this.enqueue(() => {
			this.state = structuredClone(state);
			saveState(this.options.stateFile, this.state);
			this.options.snapshotState?.();
			void meta;
		});
	}

	replaceMvu(mvu: MvuData, meta: StateWriteMeta): Promise<void> {
		return this.enqueue(() => {
			this.mvu = structuredClone(mvu);
			saveMvuData(this.options.mvuFile, this.mvu);
			this.options.snapshotMvu?.();
			void meta;
		});
	}

	private enqueue<T>(task: () => T): Promise<T> {
		const result = this.queue.then(task, task);
		this.queue = result.then(() => undefined, () => undefined);
		return result;
	}
}
