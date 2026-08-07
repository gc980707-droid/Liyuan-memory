/** 时间字段门禁：没有明确时间推进意图时，拒绝模型凭空跳时。 */
export function hasExplicitTimeAdvance(text: string): boolean {
	return /(?:过了?|经过|随后|后来|不久后|片刻后|一会儿后|几小时后|数小时后|第二天|次日|翌日|天亮|清晨|早上|上午|中午|下午|傍晚|晚上|夜里|深夜|凌晨|睡了一觉|醒来时|到了.+(?:点|时|早上|晚上|深夜|凌晨))/u.test(text);
}

export function gateTimePatch(userText: string, currentTime: string, requestedTime: unknown): { allowed: boolean; value?: string; reason?: string } {
	if (typeof requestedTime !== "string" || !requestedTime.trim()) return { allowed: true };
	if (requestedTime.trim() === currentTime.trim()) return { allowed: true, value: requestedTime };
	if (hasExplicitTimeAdvance(userText)) return { allowed: true, value: requestedTime.trim() };
	return { allowed: false, reason: `本轮用户输入没有明确时间推进意图，拒绝将时间从「${currentTime || "（未记录）"}」改为「${requestedTime}」。` };
}
