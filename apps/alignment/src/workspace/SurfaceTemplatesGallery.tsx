import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { CommandButton } from "../commands/react.js";
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
		<Dialog.Root
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-40 bg-gray-950/45 backdrop-blur-[1px] data-[state=open]:animate-in" />
				<Dialog.Content aria-label="Surface Templates gallery" className="fixed left-1/2 top-[10vh] z-50 w-[min(640px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl outline-none -translate-x-1/2 dark:border-gray-700 dark:bg-gray-900">
					<div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
						<Dialog.Title className="text-sm font-semibold text-gray-900 dark:text-gray-100">Surface Templates</Dialog.Title>
						<Dialog.Close asChild>
							<CommandButton commandId="dialog.close" label="Close Surface Templates gallery" className="ml-auto rounded-md p-1 text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-accent dark:hover:bg-gray-800">
								<X aria-hidden="true" size={16} />
							</CommandButton>
						</Dialog.Close>
					</div>
					<Dialog.Description className="sr-only">Browse Surface Template categories. Most are not backed by a real integration yet.</Dialog.Description>
					<div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-auto p-4 sm:grid-cols-3">
						{GALLERY_CATEGORIES.map((category) => (
							<CategoryCard key={category.id} category={category} />
						))}
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
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
