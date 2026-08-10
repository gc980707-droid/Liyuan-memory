/**
 * 「状态」面板（顶栏按钮开关，左栏渲染）：显示最新状态栏快照。
 * 数据源是服务端剥离正文后推送的最新快照（StatusBarSnapshot），
 * 不依赖任何正则脚本——正文里的 <Status_block> 已被 wire 层剥走。
 */

import type { StatusBarSnapshot } from "../../../server/wire.ts";

export function StatusRail({
	snapshot,
	panel,
}: {
	snapshot: StatusBarSnapshot | null;
	/** 面板模式（顶栏按钮展开的左栏面板；否则整块渲染） */
	panel?: boolean;
}) {
	const body = (
		<>
			{snapshot ? (
				<>
					<div className="status-panel-head">{snapshot.head || "当前状态"}</div>
					<div className="status-panel-fields">
						{snapshot.fields.map((f, i) => (
							<div key={i} className="status-panel-field">
								<span className="status-panel-label">{f.label}</span>
								{f.value ? <div className="status-panel-value">{f.value}</div> : null}
							</div>
						))}
					</div>
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