type JsonObject = Record<string, unknown>;

function Value({ name, value, depth = 0 }: { name: string; value: unknown; depth?: number }) {
	const legacy = Array.isArray(value) && value.length === 2 && typeof value[1] === "string";
	if (legacy) {
		return (
			<div className="mvu-leaf" style={{ paddingLeft: depth * 10 }}>
				<div className="mvu-leaf-head"><span>{name}</span><strong>{String(value[0] ?? "")}</strong></div>
				<div className="field-hint">{value[1]}</div>
			</div>
		);
	}
	if (value && typeof value === "object") {
		const entries = Object.entries(value as JsonObject);
		return (
			<details className="mvu-group" open={depth < 1} style={{ marginLeft: depth * 6 }}>
				<summary>{name} <span className="field-hint">{Array.isArray(value) ? `${entries.length} 项` : ""}</span></summary>
				<div>{entries.map(([key, child]) => <Value key={key} name={key} value={child} depth={depth + 1} />)}</div>
			</details>
		);
	}
	return (
		<div className="mvu-leaf" style={{ paddingLeft: depth * 10 }}>
			<div className="mvu-leaf-head"><span>{name}</span><strong>{value == null ? "-" : String(value)}</strong></div>
		</div>
	);
}

export function MvuPanel({ data }: { data: JsonObject }) {
	const entries = Object.entries(data);
	return (
		<div className="panel-body mvu-panel">
			<p className="field-hint">角色卡的确定性变量。剧情推进、回档和世界线会自动同步。</p>
			{entries.length ? entries.map(([key, value]) => <Value key={key} name={key} value={value} />) : <div className="empty-state">当前角色卡没有 MVU 变量。</div>}
		</div>
	);
}
