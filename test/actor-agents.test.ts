import assert from "node:assert/strict";
import test from "node:test";

import { actorProfilesFromState, buildActorPrompt, buildDirectorPrompt, buildDirectorSelectionPrompt, findProposalConflicts, formatActorProposals, parseActorProposal, parseDirectorDecision, runActorAgents, selectActiveActors } from "../src/stage/actor-agents.ts";
import type { CharacterCard, WorldState } from "../src/types.ts";

const card: CharacterCard = {
	name: "阿梨",
	description: "茶馆掌柜。",
	personality: "嘴硬，记性很好。",
	scenario: "雨夜茶馆",
	firstMes: "",
	mesExample: "",
	systemPrompt: "",
	postHistoryInstructions: "",
	creatorNotes: "",
	 alternateGreetings: [],
	tags: [],
	book: [],
};
const state: WorldState = {
	time: "雨夜",
	location: "茶馆",
	characters: { 阿梨: { affinity: 10, status: "擦杯子", notes: "欠你一壶茶" }, 老周: { affinity: -5, status: "守在门口", notes: "" } },
	inventory: [], flags: {}, plot_threads: [],
};

test("角色档案隔离共享时空与私有信息", () => {
	const profiles = actorProfilesFromState(card, state, { 老周: ["看见门外的马车"] }, { 老周: "不想让阿梨知道自己在等人" });
	assert.deepEqual(profiles.map((p) => p.name), ["阿梨", "老周"]);
	assert.equal(profiles[0]!.state?.status, "擦杯子");
	assert.equal(profiles[1]!.privateState, "不想让阿梨知道自己在等人");
	assert.match(profiles[1]!.blindSpots[0]!, /不知道其他角色/);
	assert.match(profiles[1]!.knownFacts.join("；"), /看见门外的马车/);
});

test("导演点名优先、未点名只让主角色承接、最多两名", () => {
	const profiles = actorProfilesFromState(card, { ...state, characters: { 阿梨: state.characters.阿梨!, 老周: state.characters.老周!, 小满: state.characters.老周! } });
	assert.deepEqual(selectActiveActors(profiles, "老周，把门关上").activeActors, ["老周"]);
	assert.deepEqual(selectActiveActors(profiles, "我坐下了").activeActors, ["阿梨"]);
	assert.equal(selectActiveActors(profiles, "阿梨和老周都在").activeActors.length, 2);
});

test("导演提示只列活跃角色，角色提示带盲区且不接管用户", () => {
	const profiles = actorProfilesFromState(card, state, {}, { 阿梨: "想留住这位客人" });
	profiles[0]!.blindSpots = ["不知道你为何连夜赶来"];
	const decision = selectActiveActors(profiles, "阿梨，看我一眼");
	const dp = buildDirectorPrompt(decision, profiles);
	assert.match(dp, /阿梨/);
	assert.doesNotMatch(dp, /老周/);
	assert.match(buildActorPrompt(profiles[0]!, decision), /不知道你为何连夜赶来/);
	assert.match(buildActorPrompt(profiles[0]!, decision), /不写用户/);
	assert.match(buildActorPrompt(profiles[0]!, decision), /未列出的事实一律视为未知/);
	assert.match(buildActorPrompt(profiles[0]!, decision), /不要从.*加盟.*借款.*电话.*推断/);
	assert.match(buildActorPrompt(profiles[0]!, decision), /严格 JSON/);
});

test("角色 agent：稳定档案中的长期家暴经历必须进入本轮判断", () => {
	const traumaCard = { ...card, description: "长期遭受家暴，习惯先观察对方脸色。" };
	const profile = actorProfilesFromState(traumaCard, state)[0]!;
	const prompt = buildActorPrompt(profile, selectActiveActors([profile], "我饿了"));
	assert.match(prompt, /长期家暴\/创伤经历/);
	assert.match(prompt, /不能因用户一句日常需求就把她改写成从容熟练/);
	assert.match(prompt, /本轮只提议一个可见反应和一个动作/);
});

test("角色 agent：收到场景进行中动作，不得脱离连续性另起动作", () => {
	const profile = actorProfilesFromState(card, state)[0]!;
	const prompt = buildActorPrompt(profile, selectActiveActors([profile], "客人走到厨房门口"), {
		positions: { 阿梨: "灶台边" },
		held_items: {},
		ongoing: ["阿梨正在准备清粥"],
		known_facts: ["客人有些晃"],
	});
	assert.match(prompt, /进行中=阿梨正在准备清粥/);
	assert.match(prompt, /不得用临时提案让角色放弃它/);
});

test("角色提案按 JSON 校验，错误格式只回退为该角色文本", () => {
	const profile = actorProfilesFromState(card, state)[0]!;
	assert.deepEqual(parseActorProposal('{"actor":"阿梨","content":"把杯子推过去","intendedAction":"倒水"}', profile), {
		actor: "阿梨", content: "把杯子推过去", intendedAction: "倒水",
	});
	assert.equal(parseActorProposal('{"actor":"老周","content":"越权"}', profile).actor, "阿梨");
});

test("导演 agent JSON 只允许选择名录角色，非法结果回退", () => {
	const profiles = actorProfilesFromState(card, state);
	const fallback = selectActiveActors(profiles, "我坐下了");
	assert.match(buildDirectorSelectionPrompt(profiles), /严格 JSON/);
	assert.deepEqual(parseDirectorDecision('{"activeActors":["不存在的人"],"turnFocus":"门口","stopAt":"停下"}', profiles, fallback), fallback);
	const picked = parseDirectorDecision('{"activeActors":["阿梨"],"turnFocus":"照看客人","stopAt":"交还用户"}', profiles, fallback);
	assert.deepEqual(picked.activeActors, ["阿梨"]);
	const paced = parseDirectorDecision('{"activeActors":["阿梨"],"turnFocus":"照看客人","stopAt":"交还用户","sceneGoal":"让客人先表态","tension":9}', profiles, fallback);
	assert.equal(paced.sceneGoal, "让客人先表态");
	assert.equal(paced.tension, 5);
	assert.match(buildDirectorPrompt(paced, profiles), /冲突强度：5\/5/);
});

test("角色提案冲突只提醒、不替正文模型做决定", () => {
	const conflicts = findProposalConflicts([
		{ actor: "阿梨", content: "她留下", intendedAction: "留下" },
		{ actor: "老周", content: "他转身", intendedAction: "离开" },
	]);
	assert.equal(conflicts.length, 1);
	assert.match(formatActorProposals([
		{ actor: "阿梨", content: "她留下", intendedAction: "留下" },
		{ actor: "老周", content: "他转身", intendedAction: "离开" },
	]), /提案冲突提醒/);
});

test("角色 agent 只按导演顺序调用活跃角色", async () => {
	const profiles = actorProfilesFromState(card, state);
	const seen: string[] = [];
	const decision = { activeActors: ["老周", "阿梨"], turnFocus: "门外有动静", stopAt: "交还用户" };
	const proposals = await runActorAgents(decision, profiles.map((profile) => ({ profile, respond: async () => { seen.push(profile.name); return { actor: profile.name, content: "反应", intendedAction: "停住" }; } })), { userText: "", recentText: "", sharedState: { time: state.time, location: state.location } });
	assert.deepEqual(seen, ["阿梨", "老周"]);
	assert.deepEqual(proposals.map((p) => p.actor), ["阿梨", "老周"]);
});
