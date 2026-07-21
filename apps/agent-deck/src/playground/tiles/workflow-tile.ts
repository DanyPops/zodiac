import { mockWorkflow, type WorkflowNodeKind } from "../mock-data.js";
import { attachTileHeaderIcon, tileHeaderHtml } from "../tile-header.js";

/**
 * Static, hand-positioned node/edge diagram -- not a general graph-layout
 * engine. Inspired by the visual language of ~/Repositories/open-agent-builder
 * (@xyflow/react) but this is a fixed, read-only mock of one specific
 * 8-node workflow (the QE recurring operating loop), so a serpentine
 * (boustrophedon) two-row layout is hand-coded rather than pulling in a
 * graph-editor library for something that never needs to be re-laid-out
 * or edited.
 */
const NODE_W = 150;
const NODE_H = 60;
const ROW1_Y = 30;
const ROW2_Y = 170;
const COL_X = [20, 210, 400, 590];

const POSITIONS: Record<string, { x: number; y: number }> = {
	detect: { x: COL_X[0]!, y: ROW1_Y },
	collect: { x: COL_X[1]!, y: ROW1_Y },
	correlate: { x: COL_X[2]!, y: ROW1_Y },
	inspect: { x: COL_X[3]!, y: ROW1_Y },
	decide: { x: COL_X[3]!, y: ROW2_Y },
	execute: { x: COL_X[2]!, y: ROW2_Y },
	validate: { x: COL_X[1]!, y: ROW2_Y },
	archive: { x: COL_X[0]!, y: ROW2_Y },
};

const KIND_STROKE: Record<WorkflowNodeKind, string> = {
	start: "stroke-accent-50 fill-accent-10 dark:fill-accent-80",
	agent: "stroke-info-50 fill-info-10 dark:fill-info-80",
	tool: "stroke-teal-50 fill-teal-10 dark:fill-teal-80",
	decision: "stroke-warning-30 fill-warning-10 dark:fill-warning-80",
	end: "stroke-success-50 fill-success-10 dark:fill-success-80",
};

function center(id: string): { cx: number; cy: number } {
	const p = POSITIONS[id]!;
	return { cx: p.x + NODE_W / 2, cy: p.y + NODE_H / 2 };
}

export function renderWorkflowTile(container: HTMLElement): void {
	const { nodes, edges } = mockWorkflow();

	const straightEdges = edges.filter((e) => e.from !== "archive" || e.to !== "detect");
	const repeatEdge = edges.find((e) => e.from === "archive" && e.to === "detect");

	const edgeLines = straightEdges
		.map((e) => {
			const a = center(e.from);
			const b = center(e.to);
			return `<line x1="${a.cx}" y1="${a.cy}" x2="${b.cx}" y2="${b.cy}" class="stroke-gray-300 dark:stroke-gray-600" stroke-width="1.5" marker-end="url(#arrow)" />`;
		})
		.join("");

	const repeatPath = repeatEdge
		? (() => {
				const a = center("archive");
				const b = center("detect");
				return `<path d="M ${a.cx} ${a.cy - NODE_H / 2 - 4} C ${a.cx} ${a.cy - 60}, ${b.cx} ${b.cy + 60}, ${b.cx} ${b.cy + NODE_H / 2 + 4}"
					fill="none" class="stroke-gray-300 dark:stroke-gray-600" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#arrow)" />
					<text x="${(a.cx + b.cx) / 2 - 40}" y="${(ROW1_Y + ROW2_Y) / 2 + NODE_H / 2}" class="fill-gray-400 dark:fill-gray-500 text-[10px]">repeat</text>`;
			})()
		: "";

	const nodeRects = nodes
		.map((n) => {
			const p = POSITIONS[n.id]!;
			const lines = n.label.split("\n");
			return `
				<g>
					<rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="10" class="${KIND_STROKE[n.kind]}" stroke-width="1.5" />
					${lines
						.map(
							(line, i) => `
						<text x="${p.x + NODE_W / 2}" y="${p.y + NODE_H / 2 + (i - (lines.length - 1) / 2) * 13 + 4}"
							text-anchor="middle" class="fill-gray-800 dark:fill-gray-100 text-[11px] font-medium">${line}</text>
					`,
						)
						.join("")}
				</g>
			`;
		})
		.join("");

	container.innerHTML = `
		<div class="h-full overflow-auto p-3">
			${tileHeaderHtml("workflow", "Recurring investigation loop \u00b7 synthetic workflow")}
			<svg viewBox="0 0 760 260" class="w-full h-auto min-w-[600px]">
				<defs>
					<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
						<path d="M 0 0 L 10 5 L 0 10 z" class="fill-gray-300 dark:fill-gray-600" />
					</marker>
				</defs>
				${edgeLines}
				${repeatPath}
				${nodeRects}
			</svg>
		</div>
	`;
	attachTileHeaderIcon(container, "workflow");
}
