import assert from "node:assert/strict";
import test from "node:test";

import { actorProfilesFromState, buildActorPrompt, buildDirectorPrompt, runActorAgents, selectActiveActors } from "../src/stage/actor-agents.ts";
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
});

test("角色 agent 只按导演顺序调用活跃角色", async () => {
	const profiles = actorProfilesFromState(card, state);
	const seen: string[] = [];
	const decision = { activeActors: ["老周", "阿梨"], turnFocus: "门外有动静", stopAt: "交还用户" };
	const proposals = await runActorAgents(decision, profiles.map((profile) => ({ profile, respond: async () => { seen.push(profile.name); return { actor: profile.name, content: "反应", intendedAction: "停住" }; } })), { userText: "", recentText: "", sharedState: { time: state.time, location: state.location } });
	assert.deepEqual(seen, ["阿梨", "老周"]);
	assert.deepEqual(proposals.map((p) => p.actor), ["阿梨", "老周"]);
});
