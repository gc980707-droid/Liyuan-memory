/**
 * 「状态」面板（顶栏按钮开关，左栏渲染）：显示最新状态栏快照。
 * 多角色：顶部下拉切换出场角色，每个角色一份状态字段。
 * 数据源是服务端生成管道（卡模板 + 账本 status_fields + 每拍场记生成）的产物。
 */

import { useState } from "react";
import type { StatusBarCharacter, StatusBarSnapshot } from "../../../server/wire.ts";

export function StatusRail({
	snapshot,
	panel,
}: {
	snapshot: StatusBarSnapshot | null;
	/** 面板模式（顶栏按钮展开的左栏面板；否则整块渲染） */
	panel?: boolean;
}) {
	const [char, setChar] = useState(0);
	const chars = snapshot?.characters ?? [];
	const active = chars[Math.min(char, Math.max(0, chars.length - 1))] ?? null;
	const body = (
		<>
			{snapshot && chars.length > 0 ? (
				<>
					{chars.length > 1 && (
						<div className="status-panel-picker">
							<select
								className="status-panel-select"
								value={Math.min(char, chars.length - 1)}
								onChange={(e) => setChar(Number(e.target.value))}
								aria-label="切换角色状态"
							>
								{chars.map((c, i) => (
									<option key={i} value={i}>
										{c.name}
									</option>
								))}
							</select>
						</div>
					)}
					<StatusCharView c={active} />
				</>
			) : (
				<div className="sp-empty">本卡未检测到状态栏（模型不输出 &lt;Status_block&gt;）。</div>
			)}
		</>
	);
	if (panel) {
		return <div className="status-panel-body">{body}</div>;
	}
	return (
		<aside className="status-rail" aria-label="当前状态">
			{body}
		</aside>
	);
}

function StatusCharView({ c }: { c: StatusBarCharacter }) {
	return (
		<>
			{c.head && <div className="status-panel-head">{c.head}</div>}
			<div className="status-panel-fields">
				{c.fields.map((f, i) => (
					<div key={i} className="status-panel-field">
						{f.value ? (
							<>
								<span className="status-panel-label">{f.label}</span>
								<div className="status-panel-value">{f.value}</div>
							</>
						) : (
							<span className="status-panel-title">{f.label}</span>
						)}
					</div>
				))}
			</div>
		</>
	);
}