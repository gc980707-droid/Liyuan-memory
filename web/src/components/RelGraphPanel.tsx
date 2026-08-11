/**
 * 人物关系图（左栏面板）：SVG 力导向图。
 * 数据源：账本 WorldState.relationships（harness 每拍从正文提取）。
 * 精细呈现：好感度着色连线、关系标签、节点光晕、拖拽、悬停详情、图例。
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
	const dragRef = useRef<number | null>(null);
	useEffect(() => {
		if (names.length === 0) return;
		const seed: NodePos[] = names.map((name, i) => {
			const ang = (i / names.length) * Math.PI * 2 - Math.PI / 2;
			const rad = Math.min(W, H) * 0.32;
			return { name, x: W / 2 + Math.cos(ang) * rad, y: H / 2 + Math.sin(ang) * rad, fx: null, fy: null };
		});
		const pos = new Map(seed.map((n) => [n.name, n]));
		const edgeList = edges.length ? edges : [];
		const ITER = 160;
		for (let it = 0; it < ITER; it++) {
			const k = 0.55;
			// 斥力
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
			// 弹簧（关系边）
			for (const e of edgeList) {
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
			// 中心引力 + 边界
			for (const n of seed) {
				if (n.fx === null) n.x += (W / 2 - n.x) * 0.012;
				if (n.fy === null) n.y += (H / 2 - n.y) * 0.012;
				n.x = Math.max(NODE_R + 6, Math.min(W - NODE_R - 6, n.x));
				n.y = Math.max(NODE_R + 6, Math.min(H - NODE_R - 6, n.y));
			}
		}
		setNodes(seed);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [names.join("|"), edges.length]);

	// 悬停详情
	const [hover, setHover] = useState<RelationshipEdge | null>(null);
	const [hoverNode, setHoverNode] = useState<string | null>(null);

	// 拖拽
	const onPointerDown = (idx: number, ev: React.PointerEvent) => {
		dragRef.current = idx;
		ev.currentTarget.setPointerCapture(ev.pointerId);
	};
	const onPointerMove = (ev: React.PointerEvent) => {
		if (dragRef.current === null) return;
		const rect = (ev.currentTarget as SVGSVGElement).getBoundingClientRect();
		const x = ((ev.clientX - rect.left) / rect.width) * W;
		const y = ((ev.clientY - rect.top) / rect.height) * H;
		setNodes((ns) =>
			ns.map((n, i) => (i === dragRef.current ? { ...n, x, y, fx: x, fy: y } : n)),
		);
	};
	const onPointerUp = () => {
		dragRef.current = null;
	};

	if (edges.length === 0) {
		return <div className="sp-empty">尚无人物关系——剧情互动后自动生成。</div>;
	}

	// 去重边（同对角色取 affinity 绝对值大者）
	const uniqEdges = useMemo(() => {
		const m = new Map<string, RelationshipEdge>();
		for (const e of edges) {
			const key = [e.a, e.b].sort().join("\u0000");
			const prev = m.get(key);
			if (!prev || Math.abs(e.affinity) > Math.abs(prev.affinity)) m.set(key, e);
		}
		return [...m.values()];
	}, [edges]);

	return (
		<div className="relgraph">
			<div className="relgraph-canvas">
				<svg
					viewBox={`0 0 ${W} ${H}`}
					preserveAspectRatio="xMidYMid meet"
					className="relgraph-svg"
					onPointerMove={onPointerMove}
					onPointerUp={onPointerUp}
				>
					{/* 连线 */}
					{uniqEdges.map((e, i) => {
						const a = nodes.find((n) => n.name === e.a);
						const b = nodes.find((n) => n.name === e.b);
						if (!a || !b) return null;
						const mx = (a.x + b.x) / 2;
						const my = (a.y + b.y) / 2;
						const col = affinityColor(e.affinity);
						return (
							<g key={i} className="relgraph-edge" onMouseEnter={() => setHover(e)} onMouseLeave={() => setHover(null)}>
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
							? nodeEdges.reduce((s, e) => s + (e.a === n.name ? -e.affinity : e.affinity), 0) / nodeEdges.length
							: 0;
						const halo = avg > 15 ? "#22c55e" : avg < -15 ? "#ef4444" : "#38bdf8";
						return (
							<g
								key={n.name}
								className="relgraph-node"
								transform={`translate(${n.x},${n.y})`}
								onPointerDown={(ev) => onPointerDown(idx, ev)}
								onMouseEnter={() => setHoverNode(n.name)}
								onMouseLeave={() => setHoverNode(null)}
								style={{ cursor: "grab" }}
							>
								<circle r={NODE_R + 6} fill={halo} opacity={hoverNode === n.name ? 0.5 : 0.22} />
								<circle
									r={NODE_R}
									fill={isUser ? "#0ea5e9" : isMain ? "#f59e0b" : "#334155"}
									stroke="#e2e8f0"
									strokeWidth={isUser || isMain ? 2.5 : 1.5}
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
				</svg>
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
				<span className="relgraph-hint">拖拽节点调整布局 · 悬停连线看详情</span>
			</div>
		</div>
	);
}