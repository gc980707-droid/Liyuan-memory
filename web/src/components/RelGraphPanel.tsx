/**
 * 人物关系图（左栏面板）：SVG 力导向图。
 * 数据源：账本 WorldState.relationships（harness 每拍从正文提取）。
 * 交互：滚轮缩放（以光标为锚）、拖拽平移、节点拖拽（跟手）、悬停详情、图例。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { RelationshipEdge, WorldState } from "../../../server/wire.ts";

const W = 860;
const H = 620;
const NODE_R = 26;

interface NodePos {
	name: string;
	x: number;
	y: number;
	fx: number | null;
	fy: number | null;
}

/** 好感度 → 颜色（-100 红 → 0 灰 → 100 绿） */
function affinityColor(a: number): string {
	if (a >= 40) return "#22c55e";
	if (a > 0) return "#84cc16";
	if (a === 0) return "#94a3b8";
	if (a >= -40) return "#f97316";
	return "#ef4444";
}

function affinityLabel(a: number): string {
	if (a >= 40) return "亲近";
	if (a > 0) return "友善";
	if (a === 0) return "中立";
	if (a >= -40) return "冷淡";
	return "敌对";
}

export function RelGraphPanel({ state, charName, userName }: { state: WorldState | null; charName: string; userName: string }) {
	const edges = state?.relationships ?? [];
	// 去重边（同对角色取 affinity 绝对值大者）——必须无条件执行（hooks 顺序稳定）
	const uniqEdges = useMemo(() => {
		const m = new Map<string, RelationshipEdge>();
		for (const e of edges) {
			const key = [e.a, e.b].sort().join("\u0000");
			const prev = m.get(key);
			if (!prev || Math.abs(e.affinity) > Math.abs(prev.affinity)) m.set(key, e);
		}
		return [...m.values()];
	}, [edges]);
	// 节点 = 所有关系里出现的角色 + 主角/用户
	const names = useMemo(() => {
		const set = new Set<string>();
		for (const e of edges) {
			set.add(e.a);
			set.add(e.b);
		}
		if (charName) set.add(charName);
		if (userName) set.add(userName);
		return [...set];
	}, [edges, charName, userName]);

	// 力导向布局（Fruchterman-Reingold 简化：斥力 + 弹簧 + 中心引力）
	const [nodes, setNodes] = useState<NodePos[]>([]);
	useEffect(() => {
		if (names.length === 0) return;
		const seed: NodePos[] = names.map((name, i) => {
			const ang = (i / names.length) * Math.PI * 2 - Math.PI / 2;
			const rad = Math.min(W, H) * 0.32;
			return { name, x: W / 2 + Math.cos(ang) * rad, y: H / 2 + Math.sin(ang) * rad, fx: null, fy: null };
		});
		const pos = new Map(seed.map((n) => [n.name, n]));
		const ITER = 160;
		for (let it = 0; it < ITER; it++) {
			const k = 0.55;
			for (let i = 0; i < seed.length; i++) {
				for (let j = i + 1; j < seed.length; j++) {
					const a = seed[i];
					const b = seed[j];
					let dx = a.x - b.x;
					let dy = a.y - b.y;
					let d = Math.hypot(dx, dy) || 1;
					const force = (k * k) / d;
					const f = Math.min(force, 6);
					dx = (dx / d) * f;
					dy = (dy / d) * f;
					a.x += dx;
					a.y += dy;
					b.x -= dx;
					b.y -= dy;
				}
			}
			for (const e of edges) {
				const a = pos.get(e.a);
				const b = pos.get(e.b);
				if (!a || !b) continue;
				const rest = 150 - (Math.abs(e.affinity) / 100) * 55;
				let dx = b.x - a.x;
				let dy = b.y - a.y;
				const d = Math.hypot(dx, dy) || 1;
				const f = (d - rest) * 0.018;
				dx = (dx / d) * f;
				dy = (dy / d) * f;
				a.x += dx;
				a.y += dy;
				b.x -= dx;
				b.y -= dy;
			}
			for (const n of seed) {
				if (n.fx === null) n.x += (W / 2 - n.x) * 0.012;
				if (n.fy === null) n.y += (H / 2 - n.y) * 0.012;
				n.x = Math.max(NODE_R + 6, Math.min(W - NODE_R - 6, n.x));
				n.y = Math.max(NODE_R + 6, Math.min(H - NODE_R - 6, n.y));
			}
		}
		setNodes(seed);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [names.join("|")]);

	// 视口变换（缩放 + 平移）
	const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
	const svgRef = useRef<SVGSVGElement>(null);
	const dragRef = useRef<number | null>(null);
	const dragOffsetRef = useRef({ dx: 0, dy: 0 });
	const panRef = useRef<{ px: number; py: number } | null>(null);

	/** 屏幕坐标 → viewBox 坐标（getScreenCTM 逆变换，自动处理 preserveAspectRatio 留白） */
	const toViewBox = (clientX: number, clientY: number): { x: number; y: number } => {
		const svg = svgRef.current;
		if (!svg) return { x: 0, y: 0 };
		const pt = svg.createSVGPoint();
		pt.x = clientX;
		pt.y = clientY;
		const ctm = svg.getScreenCTM();
		if (!ctm) return { x: 0, y: 0 };
		const p = pt.matrixTransform(ctm.inverse());
		return { x: p.x, y: p.y };
	};
	/** 屏幕坐标 → 世界坐标（viewBox 再反变换我的视口 translate/scale） */
	const toWorld = (clientX: number, clientY: number): { x: number; y: number } => {
		const vb = toViewBox(clientX, clientY);
		return { x: (vb.x - view.tx) / view.scale, y: (vb.y - view.ty) / view.scale };
	};

	// 滚轮缩放（以光标为锚，锚点用 CTM 转的 viewBox 坐标）
	const onWheel = (ev: React.WheelEvent) => {
		const vb = toViewBox(ev.clientX, ev.clientY);
		const factor = Math.exp(-ev.deltaY * 0.0012);
		setView((v) => {
			const ns = Math.max(0.3, Math.min(3, v.scale * factor));
			const k = ns / v.scale;
			return { scale: ns, tx: vb.x - (vb.x - v.tx) * k, ty: vb.y - (vb.y - v.ty) * k };
		});
	};
	// 空白处拖拽平移
	const onPanDown = (ev: React.PointerEvent) => {
		if (dragRef.current !== null) return;
		const vb = toViewBox(ev.clientX, ev.clientY);
		panRef.current = { px: vb.x, py: vb.y };
		svgRef.current?.setPointerCapture(ev.pointerId);
	};
	const onMove = (ev: React.PointerEvent) => {
		if (dragRef.current !== null) {
			const w = toWorld(ev.clientX, ev.clientY);
			const off = dragOffsetRef.current;
			const x = w.x + off.dx;
			const y = w.y + off.dy;
			setNodes((ns) => ns.map((n, i) => (i === dragRef.current ? { ...n, x, y, fx: x, fy: y } : n)));
			return;
		}
		if (panRef.current) {
			const vb = toViewBox(ev.clientX, ev.clientY);
			const pan = panRef.current;
			setView((v) => ({ ...v, tx: v.tx + (vb.x - pan.px), ty: v.ty + (vb.y - pan.py) }));
			panRef.current = { px: vb.x, py: vb.y };
		}
	};
	const onUp = () => {
		dragRef.current = null;
		panRef.current = null;
	};

	// 悬停详情
	const [hover, setHover] = useState<RelationshipEdge | null>(null);
	const [hoverNode, setHoverNode] = useState<string | null>(null);
	// 选中角色（点击节点弹出信息卡）
	const [selected, setSelected] = useState<string | null>(null);
	const selectNode = (name: string) => setSelected((cur) => (cur === name ? null : name));

	// 节点拖拽按下：记录偏移（鼠标与节点中心的差），保证跟手；捕获到 svg（move 事件统一走 svg）
	const onNodeDown = (idx: number, ev: React.PointerEvent) => {
		const w = toWorld(ev.clientX, ev.clientY);
		const n = nodes[idx];
		if (!n) return;
		dragRef.current = idx;
		dragOffsetRef.current = { dx: n.x - w.x, dy: n.y - w.y };
		svgRef.current?.setPointerCapture(ev.pointerId);
	};

	if (edges.length === 0) {
		return <div className="sp-empty">尚无人物关系——剧情互动后自动生成。</div>;
	}

	return (
		<div className="relgraph">
			<div className="relgraph-canvas">
				<svg
					ref={svgRef}
					viewBox={`0 0 ${W} ${H}`}
					preserveAspectRatio="xMidYMid meet"
					className="relgraph-svg"
					onWheel={onWheel}
					onPointerDown={onPanDown}
					onPointerMove={onMove}
					onPointerUp={onUp}
					onPointerCancel={onUp}
				>
					<g transform={`translate(${view.tx},${view.ty}) scale(${view.scale})`}>
						{/* 连线 */}
						{uniqEdges.map((e, i) => {
							const a = nodes.find((n) => n.name === e.a);
							const b = nodes.find((n) => n.name === e.b);
							if (!a || !b) return null;
							const mx = (a.x + b.x) / 2;
							const my = (a.y + b.y) / 2;
							const col = affinityColor(e.affinity);
							return (
								<g
									key={i}
									className="relgraph-edge"
									onMouseEnter={() => setHover(e)}
									onMouseLeave={() => setHover(null)}
								>
									<line
										x1={a.x}
										y1={a.y}
										x2={b.x}
										y2={b.y}
										stroke={col}
										strokeWidth={2 + Math.abs(e.affinity) / 30}
										strokeOpacity={0.75}
									/>
									{e.relation && (
										<g transform={`translate(${mx},${my})`}>
											<rect
												x={-e.relation.length * 7 - 6}
												y={-10}
												width={e.relation.length * 14 + 12}
												height={20}
												rx={10}
												fill="#1e293b"
												stroke={col}
												strokeOpacity={0.5}
											/>
											<text className="relgraph-relation" textAnchor="middle" dy={4}>
												{e.relation}
											</text>
										</g>
									)}
								</g>
							);
						})}
						{/* 节点 */}
						{nodes.map((n, idx) => {
							const isUser = n.name === userName;
							const isMain = n.name === charName;
							const nodeEdges = uniqEdges.filter((e) => e.a === n.name || e.b === n.name);
							const avg = nodeEdges.length
								? nodeEdges.reduce((s, e) => s + (e.a === n.name ? -e.affinity : e.affinity), 0) /
									nodeEdges.length
								: 0;
							const halo = avg > 15 ? "#22c55e" : avg < -15 ? "#ef4444" : "#38bdf8";
							return (
								<g
									key={n.name}
									className="relgraph-node"
									transform={`translate(${n.x},${n.y})`}
									onPointerDown={(ev) => onNodeDown(idx, ev)}
									onClick={() => selectNode(n.name)}
									onMouseEnter={() => setHoverNode(n.name)}
									onMouseLeave={() => setHoverNode(null)}
									style={{ cursor: "grab" }}
								>
									<circle r={NODE_R + 6} fill={halo} opacity={hoverNode === n.name ? 0.5 : 0.22} />
									<circle
										r={NODE_R}
										fill={isUser ? "#0ea5e9" : isMain ? "#f59e0b" : "#334155"}
										stroke={selected === n.name ? "#fbbf24" : "#e2e8f0"}
										strokeWidth={selected === n.name ? 3 : isUser || isMain ? 2.5 : 1.5}
									/>
									<text className="relgraph-node-char" textAnchor="middle" dy={5}>
										{n.name.slice(0, 1)}
									</text>
									<text className="relgraph-node-name" textAnchor="middle" dy={NODE_R + 16}>
										{n.name}
									</text>
								</g>
							);
						})}
					</g>
				</svg>
				{selected && (
					<CharInfoCard
						name={selected}
						charName={charName}
						userName={userName}
						state={state}
						edges={uniqEdges}
						onClose={() => setSelected(null)}
					/>
				)}
				{hover && (
					<div className="relgraph-tip">
						<strong>
							{hover.a} ↔ {hover.b}
						</strong>
						<div>
							<span style={{ color: affinityColor(hover.affinity) }}>{hover.relation}</span> ·{" "}
							{affinityLabel(hover.affinity)}（{hover.affinity > 0 ? "+" : ""}
							{hover.affinity}）
						</div>
						{hover.note && <div className="relgraph-tip-note">{hover.note}</div>}
					</div>
				)}
			</div>
			<div className="relgraph-legend">
				<span className="relgraph-legend-title">好感度</span>
				<span style={{ color: "#ef4444" }}>敌对</span>
				<span style={{ color: "#f97316" }}>冷淡</span>
				<span style={{ color: "#94a3b8" }}>中立</span>
				<span style={{ color: "#84cc16" }}>友善</span>
				<span style={{ color: "#22c55e" }}>亲近</span>
				<span className="relgraph-hint">滚轮缩放 · 空白拖拽平移 · 拖节点调整 · 点击节点看信息</span>
			</div>
		</div>
	);
}

/** 点击角色节点弹出的信息卡（数据来自账本 characters/roster + 关系边） */
function CharInfoCard({
	name,
	charName,
	userName,
	state,
	edges,
	onClose,
}: {
	name: string;
	charName: string;
	userName: string;
	state: WorldState | null;
	edges: RelationshipEdge[];
	onClose: () => void;
}) {
	const cs = state?.characters?.[name];
	const roster = state?.roster?.characters?.[name];
	const isUser = name === userName;
	const isMain = name === charName;
	const related = edges.filter((e) => e.a === name || e.b === name);
	const withMe = edges.find((e) => (e.a === name && e.b === userName) || (e.b === name && e.a === userName));
	return (
		<div className="relgraph-char-card" onClick={(e) => e.stopPropagation()}>
			<button type="button" className="relgraph-card-close" onClick={onClose} aria-label="关闭">
				✕
			</button>
			<div className="relgraph-card-head">
				<span
					className="relgraph-card-avatar"
					style={{ background: isUser ? "#0ea5e9" : isMain ? "#f59e0b" : "#334155" }}
				>
					{name.slice(0, 1)}
				</span>
				<div>
					<div className="relgraph-card-name">{name}</div>
					<div className="relgraph-card-tags">
						{isUser ? <span className="relgraph-card-tag">你</span> : null}
						{isMain ? <span className="relgraph-card-tag">主角</span> : null}
					</div>
				</div>
			</div>
			{withMe && (
				<div className="relgraph-card-row">
					<span className="relgraph-card-k">对你的态度</span>
					<span style={{ color: affinityColor(withMe.affinity) }}>
						{withMe.relation} · {affinityLabel(withMe.affinity)}（{withMe.affinity > 0 ? "+" : ""}
						{withMe.affinity}）
					</span>
				</div>
			)}
			{cs?.status && (
				<div className="relgraph-card-row">
					<span className="relgraph-card-k">状态</span>
					<span className="relgraph-card-v">{cs.status}</span>
				</div>
			)}
			{roster && (
				<div className="relgraph-card-row">
					<span className="relgraph-card-k">简介</span>
					<span className="relgraph-card-v">{roster}</span>
				</div>
			)}
			{cs?.notes && (
				<div className="relgraph-card-row">
					<span className="relgraph-card-k">备注</span>
					<span className="relgraph-card-v">{cs.notes}</span>
				</div>
			)}
			{related.length > 0 && (
				<div className="relgraph-card-rel">
					<div className="relgraph-card-rel-title">关联</div>
					{related.map((e, i) => {
						const other = e.a === name ? e.b : e.a;
						return (
							<div key={i} className="relgraph-card-rel-row">
								<span className="relgraph-card-rel-name">↔ {other}</span>
								<span style={{ color: affinityColor(e.affinity) }}>
									{e.relation}（{e.affinity > 0 ? "+" : ""}
									{e.affinity}）
								</span>
							</div>
						);
					})}
				</div>
			)}
			{!cs && !roster && !withMe && related.length === 0 && (
				<div className="relgraph-card-empty">（暂无记录——剧情互动后自动生成）</div>
			)}
		</div>
	);
}