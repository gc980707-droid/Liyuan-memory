/**
 * 「状态」面板（顶栏按钮开关，左栏渲染）：显示最新状态栏快照。
 * 数据源是服务端渲染管道（卡模板 + 账本 status_fields + 场记补全）的产物，
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
					{snapshot.head && <div className="status-panel-head">{snapshot.head}</div>}
					<div className="status-panel-fields">
						{snapshot.fields.map((f, i) => (
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