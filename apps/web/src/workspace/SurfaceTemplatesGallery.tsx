import * as Dialog from "@radix-ui/react-dialog";
import { DialogChrome } from "@zodiac/ui";
import { useEffect, useState } from "react";
import { DialogCloseButton } from "../commands/DialogCloseButton.js";
import { cn } from "../platform/cn.js";
import { GALLERY_CATEGORIES, type GalleryCategory } from "./gallery-categories.js";

/** How long each face (icon cluster, then preview) shows before cross-fading to the other -- per the settled "automatic loop" discussion. */
const CROSS_FADE_INTERVAL_MS = 3000;

interface SurfaceTemplatesGalleryProps {
	readonly open: boolean;
	readonly onClose: () => void;
}

/**
 * The categorized, iOS-App-Library-style gallery reached from the Surface
 * Templates pillar's book icon -- discovery/browsing for every category
 * (most are UI-only stubs today, see gallery-categories.tsx), not a
 * dockable-template picker. Real templates (Activity) still dock via the
 * pillar's own glyphs, drag, or TemplatesDialog's keyboard-native flow --
 * this gallery has no dock action of its own.
 */
export function SurfaceTemplatesGallery({ open, onClose }: SurfaceTemplatesGalleryProps): React.JSX.Element {
	return (
		<DialogChrome variant="dialog" open={open} onOpenChange={(next) => !next && onClose()} width={640} topOffsetVh={10} ariaLabel="Surface Templates gallery">
			<div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
				<Dialog.Title className="text-sm font-semibold text-gray-900 dark:text-gray-100">Surface Templates</Dialog.Title>
				<DialogCloseButton label="Close Surface Templates gallery" />
			</div>
			<Dialog.Description className="sr-only">Browse Surface Template categories. Most are not backed by a real integration yet.</Dialog.Description>
			<div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-auto p-4 sm:grid-cols-3">
				{GALLERY_CATEGORIES.map((category) => (
					<CategoryCard key={category.id} category={category} />
				))}
			</div>
		</DialogChrome>
	);
}

function CategoryCard({ category }: { readonly category: GalleryCategory }): React.JSX.Element {
	const [showingPreview, setShowingPreview] = useState(false);

	useEffect(() => {
		const intervalId = setInterval(() => setShowingPreview((current) => !current), CROSS_FADE_INTERVAL_MS);
		return () => clearInterval(intervalId);
	}, []);

	return (
		<div className="flex flex-col items-center gap-1.5">
			<div className="relative aspect-square w-full overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-800">
				<div className={cn("absolute inset-0 grid grid-cols-2 place-items-center gap-2 p-3 transition-opacity duration-500 motion-reduce:transition-none", showingPreview ? "opacity-0" : "opacity-100")}>
					{category.icons.slice(0, 4).map((Icon, index) => (
						<Icon key={index} size={18} className="text-gray-500 dark:text-gray-400" />
					))}
				</div>
				<div className={cn("absolute inset-0 flex items-center transition-opacity duration-500 motion-reduce:transition-none", showingPreview ? "opacity-100" : "opacity-0")}>{category.renderPreview()}</div>
			</div>
			<p className="text-xs font-medium text-gray-700 dark:text-gray-200">{category.title}</p>
		</div>
	);
}
