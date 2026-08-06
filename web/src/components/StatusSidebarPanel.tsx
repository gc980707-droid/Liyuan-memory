import { HtmlFrame } from "./HtmlFrame.tsx";

export type SidebarStatus =
	| { kind: "html"; html: string; scripts: boolean }
	| { kind: "status"; body: string };

export function StatusSidebarPanel({ status }: { status: SidebarStatus | null }) {
	return (
		<div className="panel-body status-sidebar-panel">
			<p className="field-hint">取自当前世界线最新一条角色回复，回档后自动恢复。</p>
			{!status ? <div className="empty-state">当前对话还没有可识别的状态栏。</div> : null}
			{status?.kind === "html" ? (
				<HtmlFrame html={status.html} scripts={status.scripts} seamless minHeight={180} maxHeight={1200} title="角色状态栏" />
			) : null}
			{status?.kind === "status" ? <pre className="status-sidebar-text">{status.body}</pre> : null}
		</div>
	);
}
