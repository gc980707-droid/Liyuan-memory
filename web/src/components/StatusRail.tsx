/**
 * 「状态」面板（顶栏按钮开关，左栏渲染）：显示最新状态栏快照。
 * 多角色：顶部下拉切换出场角色。
 * 显示：卡自带美化模板（皮肤）渲染的 HTML 优先（HtmlFrame）；
 * 无皮肤回落默认字段面板。字段值里的 [IMG:url|desc] 渲染成图片。
 * 全链路 harness 生成，零正则脚本。
 */

import { useState } from "react";
import type { StatusBarCharacter, StatusBarSnapshot } from "../../../server/wire.ts";
import { HtmlFrame } from "./HtmlFrame.tsx";

/** 字段值里的 [IMG:url|desc] 图片标记 → <img>（手动扫描，非替换脚本） */
function renderValueText(text: string): React.ReactNode[] {
	const out: React.ReactNode[] = [];
	let cursor = 0;
	let key = 0;
	let i = 0;
	while (i < text.length) {
		if (text[i] === "[" && text.slice(i, i + 4).toLowerCase() === "[img") {
			const close = text.indexOf("]", i);
			if (close === -1) break;
			const body = text.slice(i + 4, close);
			const sep = body.indexOf("|");
			const url = (sep >= 0 ? body.slice(0, sep) : body).trim();
			const desc = sep >= 0 ? body.slice(sep + 1).trim() : "";
			if (/^https?:\/\/\S+$/i.test(url)) {
				if (cursor < i) out.push(text.slice(cursor, i));
				out.push(
					<img
						key={key++}
						className="status-panel-img"
						src={url}
						alt={desc || "状态栏配图"}
						loading="lazy"
					/>,
				);
				cursor = close + 1;
				i = cursor;
				continue;
			}
		}
		i++;
	}
	if (cursor < text.length) out.push(text.slice(cursor));
	return out;
}

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
	// 卡自带美化模板（皮肤）渲染的 HTML：直接嵌入显示（无痕 iframe）
	if (c.html) {
		return (
			<div className="status-panel-skin">
				<HtmlFrame html={c.html} seamless />
			</div>
		);
	}
	return (
		<>
			{c.head && <div className="status-panel-head">{c.head}</div>}
			<div className="status-panel-fields">
				{c.fields.map((f, i) => (
					<div key={i} className="status-panel-field">
						{f.value ? (
							<>
								<span className="status-panel-label">{f.label}</span>
								<div className="status-panel-value">{renderValueText(f.value)}</div>
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