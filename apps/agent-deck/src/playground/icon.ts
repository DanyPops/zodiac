import { createElement, type IconNode } from "lucide";

/** Thin wrapper over lucide's vanilla createElement, with this app's own consistent sizing defaults. */
export function icon(node: IconNode, opts: { size?: number; strokeWidth?: number; className?: string } = {}): SVGElement {
	const el = createElement(node, {
		width: opts.size ?? 16,
		height: opts.size ?? 16,
		"stroke-width": opts.strokeWidth ?? 1.75,
	});
	if (opts.className) el.setAttribute("class", opts.className);
	return el;
}

export function iconHtml(node: IconNode, opts: { size?: number; strokeWidth?: number; className?: string } = {}): string {
	return icon(node, opts).outerHTML;
}
