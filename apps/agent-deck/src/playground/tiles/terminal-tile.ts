import { CATEGORIES } from "../category.js";
import { icon } from "../icon.js";
import { mockTerminalSession, type TerminalLine } from "../mock-data.js";

const LINE_CLASSES: Record<TerminalLine["kind"], string> = {
	command: "text-gray-100 font-medium",
	output: "text-gray-400",
	error: "text-danger-30",
	info: "text-teal-30",
};

function lineHtml(line: TerminalLine): string {
	return `<div class="${LINE_CLASSES[line.kind]} whitespace-pre-wrap">${line.text}</div>`;
}

/** Terminals conventionally stay dark regardless of the app theme -- this tile intentionally doesn't follow dark:/light: variants. */
export function renderTerminalTile(container: HTMLElement): void {
	const lines = mockTerminalSession();
	container.innerHTML = `
		<div class="h-full flex flex-col bg-gray-950 border-t-[3px] ${CATEGORIES.terminal.accentBorder}">
			<div class="flex items-center gap-2 px-3 py-2 border-b border-gray-800">
				<span class="terminal-header-icon flex items-center justify-center h-6 w-6 rounded-lg bg-success-80 text-success-20 shrink-0"></span>
				<span class="text-xs text-gray-400">Agent terminal \u00b7 synthetic session</span>
			</div>
			<div class="flex-1 overflow-auto p-3 font-mono text-[12px] leading-relaxed space-y-0.5">
				${lines.map(lineHtml).join("")}
				<div class="flex items-center gap-1 text-gray-100">
					<span>$</span>
					<span class="inline-block w-2 h-4 bg-gray-100 animate-pulse"></span>
				</div>
			</div>
		</div>
	`;
	container.querySelector(".terminal-header-icon")?.appendChild(icon(CATEGORIES.terminal.icon, { size: 13 }));
}
