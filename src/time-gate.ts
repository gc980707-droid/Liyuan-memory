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

/** 状态栏也不能显示一个没有被世界状态确认的新时间。 */
export function gateStatusTime(userText: string, currentTime: string, statusText: string): { allowed: boolean; reason?: string } {
	const current = currentTime.match(/(?:上午|下午|晚上|夜里|深夜|凌晨)?\s*(\d{1,2})\s*[:：点时]\s*(\d{2})?/u);
	const requested = statusText.match(/(?:上午|下午|晚上|夜里|深夜|凌晨)?\s*(\d{1,2})\s*[:：点时]\s*(\d{2})?/u);
	if (!current || !requested) return { allowed: true };
	const currentValue = Number(current[1]) * 60 + Number(current[2] || 0);
	const requestedValue = Number(requested[1]) * 60 + Number(requested[2] || 0);
	if (currentValue === requestedValue || hasExplicitTimeAdvance(userText)) return { allowed: true };
	return { allowed: false, reason: `状态栏时间「${requested[0]}」与当前世界状态「${current[0]}」不一致；本轮没有明确时间推进，必须按世界状态填写。` };
}
