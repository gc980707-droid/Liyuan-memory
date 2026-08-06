import { HtmlFrame } from "./HtmlFrame.tsx";
import { MvuPanel } from "./MvuPanel.tsx";

export type SidebarStatus =
	| { kind: "html"; html: string; scripts: boolean }
	| { kind: "status"; body: string };

export function StatusSidebarPanel({ status, mvu }: { status: SidebarStatus | null; mvu: Record<string, unknown> }) {
	return (
		<div className="panel-body status-sidebar-panel">
			<p className="field-hint">取自当前世界线最新一条角色回复，回档后自动恢复。</p>
			{!status ? <div className="empty-state">当前对话还没有可识别的状态栏。</div> : null}
			{status?.kind === "html" ? (
				<HtmlFrame html={status.html} scripts={status.scripts} seamless minHeight={180} maxHeight={20_000} expandToContent title="角色状态栏" />
			) : null}
			{status?.kind === "status" ? <pre className="status-sidebar-text">{status.body}</pre> : null}
			{Object.keys(mvu).length ? (
				<details className="mvu-group status-mvu" open={!status}>
					<summary>变量数据</summary>
					<MvuPanel data={mvu} compact />
				</details>
			) : null}
		</div>
	);
}
