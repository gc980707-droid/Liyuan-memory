/**
 * 场记调度（PLAN-RP-HARNESS M3，R8 记账独占 + R9 叶守卫）。
 *
 * 定稿之后一次旁路调用：读【当前账本 + 本拍对白】→ 出 patch → applyPatch →
 * rp-state 快照落树。台上零世界写入工具，主演只通过正文（含状态栏）表达状态变化。
 *
 * 叶守卫：旁路调用是异步的，期间用户可能 swipe/rewind/切世界线。落树前核对叶位置，
 * 变了就整体丢弃本次记账——快照绝不能写到导航后的分支上（8/02 账本泄漏事故的结构性解法）。
 * 丢弃是安全的：账本 = f(分支)（R4），新分支自会从它自己的最近快照重建。
 *
 * 纯函数 + 注入依赖，零 pi 依赖、可单测。
 */

import { applyPatch, canonicalizeCharacterKeys, saveState } from "../state.ts";
import { applyMvuPatch, mvuTimePatchIfMissing, projectMvuToWorldState } from "../mvu.ts";
import { buildScribeTurnPrompt, parseScribeResult } from "../scribe.ts";
import type { WorldState } from "../types.ts";

/** 场记快照的会话树条目类型（CustomEntry，不进 LLM 上下文） */
export const STATE_ENTRY_TYPE = "rp-state";

export interface ScribeRunDeps {
	/** 旁路文本调用：返回文本，或 {error} */
	sideText: (systemPrompt: string, userText: string) => Promise<string | { error: string }>;
	/** 记账落树（CustomEntry：data 存整份账本快照） */
	appendStateEntry: (state: WorldState) => void;
	/** 叶守卫读数：调用前后各取一次，不等则丢弃 */
	getLeafId: () => string | null;
	/** 旁路调用结束后读取当前分支的最新账本，避免使用开拍时的旧快照覆盖新状态。 */
	getCurrentState?: () => WorldState;
	/** 磁盘缓存路径（.liyuan-state/<sessionId>.json）；给出则落盘（server fs.watch → state 帧） */
	stateFile?: string;
	onActivity?: (detail: string) => void;
	/** MVU 卡没有可投影的通用账本时，仍允许提交仅 mvu 的更新。 */
}

export interface ScribeRunInput {
	/** 本拍开演前的账本（= f(分支)） */
	state: WorldState;
	userText: string;
	/** 本拍定稿正文（补丁已套） */
	assistantText: string;
	charName: string;
	userName: string;
	mvuRules?: string;
}

export type ScribeRunOutcome =
	| { kind: "skipped"; reason: string }
	| { kind: "stale" }
	| { kind: "failed"; error: string }
	| { kind: "applied"; state: WorldState; applied: string[] };

function restrictMvuPatchToUserAction(patch: Record<string, unknown>, userText: string): Record<string, unknown> {
	const has = (re: RegExp) => re.test(userText);
	const canFire = has(/开枪|射击|扣动扳机|开火|点射|扫射|击发|扳机/u);
	// Avoid substring false positives such as「走神」being interpreted as a move.
	const canMove = has(/走(?!神)|跑|进入|离开|下楼|上楼|移动|靠近|退后|转身|躲|前往|摸向/u);
	const canHandleItems = has(/拿|捡|拾取|装入|收起|丢|放下|穿戴|卸下|打包|压缩|搜刮|装备/u);
	const next: Record<string, unknown> = {};
	for (const [path, value] of Object.entries(patch)) {
		if (!canFire && /弹|弹药|子弹|弹匣/u.test(path)) continue;
		if (!canMove && /(?:^|\.)坐标\.当前位置(?:\.|$)|(?:^|\.)当前位置(?:\.|$)/u.test(path)) continue;
		if (!canHandleItems && /主角\.资产\.(?:背包内容|保险箱内容|仓库|装备)/u.test(path)) continue;
		if (typeof value === "string" && !value.trim() && !/时间/u.test(path)) continue;
		next[path] = value;
	}
	return next;
}

/**
 * 一拍记账。调用方保证：只对干净收笔的台上拍调用（中断半拍/戏外轮不记账）。
 * 任何失败都只跳过本拍记账，不影响正文——账本滞后一拍可由下拍补上。
 */
export async function runScribeTurn(deps: ScribeRunDeps, input: ScribeRunInput): Promise<ScribeRunOutcome> {
	const { state, userText, assistantText, charName, userName } = input;
	if (!assistantText.trim()) return { kind: "skipped", reason: "no-text" };

	const leafBefore = deps.getLeafId();
	const currentStateBefore = deps.getCurrentState?.() ?? state;
	const prompt = buildScribeTurnPrompt({
		state: currentStateBefore,
		userText,
		assistantText,
		charName,
		userName,
		mvuRules: input.mvuRules,
	});
	const resp = await deps.sideText(prompt.systemPrompt, prompt.userText);
	if (typeof resp !== "string") return { kind: "failed", error: resp.error };

	const parsed = parseScribeResult(resp);
	if (!parsed) {
		// 短响应直接给全文（多半是格式跑偏）；长响应给尾部（多半是 maxTokens 截断）
		const flat = resp.trim().replace(/\s+/g, " ");
		const detail = flat.length <= 400 ? flat : `…${flat.slice(-160)}`;
		return { kind: "failed", error: `输出不可解析（${resp.length} 字）：${detail}` };
	}
	const restrictedMvuPatch = currentStateBefore.mvu
		? restrictMvuPatchToUserAction(parsed.mvuPatch ?? {}, userText)
		: parsed.mvuPatch;
	const mvuPatch = currentStateBefore.mvu
		? mvuTimePatchIfMissing(currentStateBefore.mvu, restrictedMvuPatch ?? {})
		: parsed.mvuPatch;
	const mvuHasChanges = !!mvuPatch && Object.keys(mvuPatch).length > 0;
	if (Object.keys(parsed.patch).length === 0 && !mvuHasChanges) return { kind: "skipped", reason: "empty-patch" };

	// R9 叶守卫：调用期间树动过（swipe/rewind/切线）→ 整体丢弃
	if (deps.getLeafId() !== leafBefore) {
		deps.onActivity?.("记账已丢弃（本拍期间切换了分支）");
		return { kind: "stale" };
	}

	// 旁路模型运行期间可能已经有前一拍状态写入当前分支。叶子没变不代表
	// 调用前的 state 仍是最新值，因此提交必须以当前分支快照为基准。
	const currentState = deps.getCurrentState?.() ?? currentStateBefore;
	const knownNames = [charName, userName, ...Object.keys(currentState.characters)];
	// MVU 卡的作者树是唯一事实源；通用账本仅作为投影视图，不再接受独立场记补丁。
	const result = applyPatch(
		currentState,
		currentState.mvu ? {} : canonicalizeCharacterKeys(parsed.patch, knownNames),
	);
	if (mvuHasChanges && result.state.mvu && typeof result.state.mvu === "object") {
		const safeMvuPatch = mvuTimePatchIfMissing(result.state.mvu, mvuPatch!);
		result.state.mvu = applyMvuPatch(result.state.mvu, safeMvuPatch);
		result.applied.push(...Object.keys(mvuPatch!).map((path) => `mvu.${path} 已更新`));
	}
	const projected = result.state.mvu ? projectMvuToWorldState(result.state) : result.state;
	deps.appendStateEntry(projected);
	if (deps.stateFile) {
		try {
			saveState(deps.stateFile, projected);
		} catch {
			// 缓存写失败不影响树上快照（账本权威在树，磁盘只是缓存）
		}
	}
	if (result.applied.length > 0) deps.onActivity?.(`记账 ${summarizeApplied(result.applied)}`);
	return { kind: "applied", state: projected, applied: result.applied };
}

/** 过程条用的记账摘要：条数 + 前两条中文化字段名 */
function summarizeApplied(applied: string[]): string {
	const label = (s: string): string => {
		if (s.startsWith("time")) return "时间";
		if (s.startsWith("location")) return "地点";
		if (s.startsWith("characters.")) return s.slice("characters.".length).split(" ")[0];
		if (s.startsWith("flags.")) return s.slice("flags.".length).split(" ")[0];
		if (s.startsWith("inventory")) return "物品";
		if (s.startsWith("plot_threads")) return "剧情线";
		return s.split(" ")[0];
	};
	const names = [...new Set(applied.map(label))];
	const shown = names.slice(0, 3).join("、");
	return names.length > 3 ? `${shown} 等 ${names.length} 项` : shown;
}
