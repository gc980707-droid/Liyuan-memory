import { HtmlFrame } from "./HtmlFrame.tsx";
import { MvuPanel } from "./MvuPanel.tsx";
import type { FallbackStatus } from "../statusFallback.ts";

export type SidebarStatus =
	| { kind: "html"; html: string; scripts: boolean }
	| { kind: "status"; body: string }
	| { kind: "fallback"; data: FallbackStatus };

export function StatusSidebarPanel({ status, mvu }: { status: SidebarStatus | null; mvu: Record<string, unknown> }) {
	return (
		<div className="panel-body status-sidebar-panel">
			<p className="field-hint">取自当前世界线最新一条角色回复，回档后自动恢复。</p>
			{!status ? <div className="empty-state">当前对话还没有可识别的状态栏。</div> : null}
			{status?.kind === "html" ? (
				<HtmlFrame html={status.html} scripts={status.scripts} seamless minHeight={180} maxHeight={20_000} expandToContent title="角色状态栏" />
			) : null}
			{status?.kind === "status" ? <pre className="status-sidebar-text">{status.body}</pre> : null}
			{status?.kind === "fallback" ? (
				<div className="fallback-status">
					{status.data.meta.length ? <div className="fallback-meta">{status.data.meta.join(" · ")}</div> : null}
					{status.data.sections.map((section) => (
						<section key={section.title} className="fallback-card">
							<h3>{section.title}</h3>
							{section.fields.map((field, index) => <div className="fallback-row" key={`${field.label}-${index}`}><span>{field.label}</span><strong>{field.value}</strong></div>)}
						</section>
					))}
				</div>
			) : null}
			{!status && Object.keys(mvu).length ? (
				<details className="mvu-group status-mvu" open={!status}>
					<summary>变量数据</summary>
					<MvuPanel data={mvu} compact />
				</details>
			) : null}
		</div>
	);
}
