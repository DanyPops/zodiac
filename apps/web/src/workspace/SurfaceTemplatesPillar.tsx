import { BookOpen } from "lucide-react";
import { useCommandShortcut } from "../commands/react.js";
import { cn } from "../platform/cn.js";
import { SURFACE_BG } from "@zodiac/ui";
import { iconButtonClassName } from "./icon-button-style.js";
import { PillarCap } from "./PillarCap.js";
import { PillarTooltip } from "./PillarTooltip.js";
import { TEMPLATE_DRAG_MIME_TYPE } from "./drag-constants.js";
import type { SurfaceTemplateEntry } from "./useSurfaceTemplates.js";

interface SurfaceTemplatesPillarProps {
	readonly entries: readonly SurfaceTemplateEntry[];
	/** Click or Enter on a glyph: dock immediately with the docking engine's own default placement (a new tab). Dragging a glyph, or the `templates.open` command, offers full placement choice instead. */
	readonly onDockDefault: (templateId: string, title: string) => void;
	/** Drives the Dock Ruler frame's own visibility -- wrapping the dock area for a drag's entire duration, not just while hovering a specific drop target (see DockRulerFrame). Optional: no-op by default so callers with no ruler frame to show (e.g. isolated unit tests) don't need to wire it. */
	readonly onTemplateDragStart?: () => void;
	readonly onTemplateDragEnd?: () => void;
}

/**
 * The Surface Templates pillar: mirrors Workspace Selection's glyph-pillar
 * pattern on the opposite edge. Holds the predefined catalog plus user-saved
 * templates; pulling one to the center docks it. Saving a new template is
 * reached from the docked Surface's own tab context menu instead (see
 * WindowDockview/SaveAsTemplateDialog) -- not this pillar.
 */
export function SurfaceTemplatesPillar({ entries, onDockDefault, onTemplateDragStart = () => {}, onTemplateDragEnd = () => {} }: SurfaceTemplatesPillarProps): React.JSX.Element {
	const openGalleryShortcut = useCommandShortcut("templates.openGallery");

	// Pillar Cap: the shared --app-corner-radius token, same as everywhere else -- CSS's own per-corner clamping (radius capped at half the box's own side) turns this narrow, tall nav into a true stadium once Corner Sharpness pushes the radius past half its width, exactly how a size-9 glyph button already becomes a circle at max sharpness. Never a fixed rounded-full: that would stay circular even at Corner Sharpness 0.
	return (
		<nav aria-label="Surface Templates" className={cn("relative z-20 flex h-full w-14 shrink-0 flex-col overflow-hidden rounded-[var(--app-corner-radius,16px)]", SURFACE_BG)}>
			{/* The categorized gallery (brand logos, per-category previews) -- browsing/discovery, not a dock action. TemplatesDialog's own keyboard-native filter+placement flow is still reachable via its own command/shortcut for docking a real template. */}
			<PillarTooltip side="left" label="Browse the Surface Templates gallery" shortcut={openGalleryShortcut}>
				<PillarCap commandId="templates.openGallery" label="Browse the Surface Templates gallery" edge="top">
					<BookOpen aria-hidden="true" size={18} />
				</PillarCap>
			</PillarTooltip>

			<div className="flex flex-1 flex-col items-center gap-1 overflow-auto py-2">
				{entries.map((entry) => (
					<PillarTooltip key={entry.id} side="left" label={entry.saved ? `${entry.title} (saved)` : entry.title}>
						<button
							type="button"
							draggable
							onDragStart={(event) => {
								event.dataTransfer.setData(TEMPLATE_DRAG_MIME_TYPE, entry.templateId);
								onTemplateDragStart();
							}}
							onDragEnd={onTemplateDragEnd}
							onClick={() => onDockDefault(entry.templateId, entry.title)}
							aria-label={`Dock ${entry.title}`}
							className={iconButtonClassName({ size: "lg" })}
						>
							<entry.icon aria-hidden="true" size={17} />
						</button>
					</PillarTooltip>
				))}
			</div>
		</nav>
	);
}
