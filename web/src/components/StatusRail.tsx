/**
 * 左栏「当前状态」面板（状态栏工具管道的前端落点）：
 * 数据源是服务端剥离正文后推送的最新快照（StatusBarSnapshot），
 * 不依赖任何正则脚本——正文里的 <Status_block> 已被 wire 层剥走，
 * 这里只渲染结构化字段。
 */

import type { StatusBarSnapshot } from "../../../server/wire.ts";

export function StatusRail({ snapshot }: { snapshot: StatusBarSnapshot | null }) {
	if (!snapshot) return null;
	return (
		<aside className="status-rail" aria-label="当前状态">
			<div className="status-rail-head">{snapshot.head || "当前状态"}</div>
			<div className="status-rail-body">
				{snapshot.fields.map((f, i) => (
					<div key={i} className="status-rail-field">
						<span className="status-rail-label">{f.label}</span>
						{f.value ? <div className="status-rail-value">{f.value}</div> : null}
					</div>
				))}
			</div>
		</aside>
	);
}