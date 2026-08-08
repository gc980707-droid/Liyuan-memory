/** 单个角色的隐藏动机 Agent：只产出导演参考，不直接写正文或状态。 */
export function buildCharacterIntentPrompt(input: {
	name: string;
	profile?: string;
	turnPlan: string;
}): { systemPrompt: string; userText: string } {
	return {
		systemPrompt: `你是角色「${input.name}」的独立动机 Agent。只输出该角色本轮的目标、情绪、约束和可能行动；不要写正文，不替用户做决定，不调用工具，不改变正典。${input.profile?.trim() ? `\n\n世界书角色档案（仅作背景参考，不代表本轮已发生事实）：\n${input.profile.trim().slice(0, 3000)}` : ""}\n\n编排计划：${input.turnPlan}`,
		userText: "根据当前用户输入、世界状态和 MVU 快照，给出简短隐藏动机提案。",
	};
}
