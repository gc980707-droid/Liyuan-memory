/** 时间字段门禁：没有明确时间推进意图时，拒绝模型凭空跳时。 */
export function hasExplicitTimeAdvance(text: string): boolean {
	return /(?:过了?|经过|随后|后来|不久后|片刻后|一会儿后|几小时后|数小时后|第二天|次日|翌日|天亮|清晨|早上|上午|中午|下午|傍晚|晚上|夜里|深夜|凌晨|睡了一觉|醒来时|到了.+(?:点|时|早上|晚上|深夜|凌晨))/u.test(text);
}

export type ActionDuration = { name: string; min: number; max: number };

export function inferActionDuration(text: string, declared?: { action?: unknown; durationMin?: unknown; durationMax?: unknown }): ActionDuration | null {
	const min = Number(declared?.durationMin);
	const max = Number(declared?.durationMax);
	if (typeof declared?.action === "string" && Number.isFinite(min) && Number.isFinite(max)) {
		if (min >= 0 && max >= min && max <= 1440) return { name: declared.action, min, max };
	}
	if (/(?:上厕所|去厕所|如厕|卫生间|洗手间)/u.test(text)) return { name: "使用卫生间", min: 5, max: 15 };
	return text.trim() ? { name: "本轮动作", min: 0, max: 30 } : null;
}

function clockMinutes(value: string): number | null {
	const match = value.match(/(\d{1,2})\s*(?:[:：点时])\s*(\d{2})?/u);
	if (!match) return null;
	const hour = Number(match[1]);
	const minute = Number(match[2] || 0);
	return hour >= 0 && hour < 24 && minute >= 0 && minute < 60 ? hour * 60 + minute : null;
}

function withClock(value: string, minutes: number): string | null {
	const current = clockMinutes(value);
	if (current === null) return null;
	const next = ((current + minutes) % 1440 + 1440) % 1440;
	return value.replace(/\d{1,2}\s*(?:[:：点时])\s*\d{2}?/u, `${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`);
}

export function gateTimePatch(userText: string, currentTime: string, requestedTime: unknown, declared?: { action?: unknown; durationMin?: unknown; durationMax?: unknown }): { allowed: boolean; value?: string; reason?: string } {
	if (typeof requestedTime !== "string" || !requestedTime.trim()) return { allowed: true };
	if (requestedTime.trim() === currentTime.trim()) return { allowed: true, value: requestedTime };
	if (hasExplicitTimeAdvance(userText)) return { allowed: true, value: requestedTime.trim() };
	const action = inferActionDuration(userText, declared);
	const current = clockMinutes(currentTime);
	const requested = clockMinutes(requestedTime);
	if (action && current !== null && requested !== null) {
		const delta = (requested - current + 1440) % 1440;
		if (delta >= action.min && delta <= action.max) return { allowed: true, value: requestedTime.trim() };
		const suggestion = withClock(currentTime, action.min);
		return { allowed: false, reason: `动作「${action.name}」预计耗时 ${action.min}～${action.max} 分钟，目标时间「${requestedTime}」超出范围。建议使用「${suggestion ?? currentTime}」。` };
	}
	return { allowed: false, reason: `动作「${action?.name ?? "本轮动作"}」声明耗时范围不足以支持目标时间「${requestedTime}」。请声明 action、durationMin、durationMax，或使用明确时间推进语句。` };
}

/** 状态栏也不能显示一个没有被世界状态确认的新时间。 */
export function gateStatusTime(userText: string, currentTime: string, statusText: string): { allowed: boolean; reason?: string } {
	const current = currentTime.match(/(?:上午|下午|晚上|夜里|深夜|凌晨)?\s*(\d{1,2})\s*[:：点时]\s*(\d{2})?/u);
	const requested = statusText.match(/(?:上午|下午|晚上|夜里|深夜|凌晨)?\s*(\d{1,2})\s*[:：点时]\s*(\d{2})?/u);
	if (!current || !requested) return { allowed: true };
	const currentValue = Number(current[1]) * 60 + Number(current[2] || 0);
	const requestedValue = Number(requested[1]) * 60 + Number(requested[2] || 0);
	if (currentValue === requestedValue || hasExplicitTimeAdvance(userText)) return { allowed: true };
	const action = inferActionDuration(userText);
	if (action && action.name !== "本轮动作") {
		const delta = (requestedValue - currentValue + 1440) % 1440;
		if (delta >= action.min && delta <= action.max) return { allowed: true };
	}
	return { allowed: false, reason: `状态栏时间「${requested[0]}」与当前世界状态「${current[0]}」不一致；本轮没有明确时间推进，必须按世界状态填写。` };
}
