import { SiExcalidraw, SiFirefox, SiGithub, SiGitlab, SiGooglechrome, SiJenkins, SiJira, SiKde, SiLinear } from "@icons-pack/react-simple-icons";
import { Folder, Image as ImageIcon, TerminalSquare } from "lucide-react";
import type { ComponentType } from "react";
import { GalleryPreviewFrame as PreviewFrame } from "./GalleryPreviewFrame.js";

interface BrandIconProps {
	size?: number;
	className?: string;
}

/**
 * The Surface Templates gallery's own category set -- UI-only stubs (see
 * "Surface Templates gallery: icon dependency and scope"): every category
 * here is browsable, but only Activity (surface-templates.tsx, not part of
 * this set) has a real backing template today. `icons` is the small brand
 * cluster a category's card cycles through; `renderPreview` is a per-
 * category illustrative mockup, not one generic reused chart.
 */
export interface GalleryCategory {
	id: string;
	title: string;
	icons: readonly ComponentType<BrandIconProps>[];
	renderPreview: () => React.ReactNode;
}

export const GALLERY_CATEGORIES: readonly GalleryCategory[] = [
	{
		id: "tickets",
		title: "Tickets",
		icons: [SiJira, SiGithub, SiGitlab, SiLinear],
		renderPreview: () => (
			<PreviewFrame>
				<div className="grid grid-cols-3 gap-1">
					{["To do", "Doing", "Done"].map((column) => (
						<div key={column} className="rounded bg-gray-200 p-1 dark:bg-gray-700">
							<p className="mb-1 text-[7px] font-semibold text-gray-500 dark:text-gray-400">{column}</p>
							<div className="h-2 rounded-sm bg-white dark:bg-gray-800" />
						</div>
					))}
				</div>
			</PreviewFrame>
		),
	},
	{
		id: "automation",
		title: "Automation",
		icons: [SiJenkins, SiGithub, SiGitlab],
		renderPreview: () => (
			<PreviewFrame>
				<div className="flex items-center gap-1">
					{[0, 1, 2].map((node) => (
						<div key={node} className="flex items-center">
							<div className="size-2.5 rounded-full bg-accent-40 dark:bg-accent-70" />
							{node < 2 && <div className="h-px w-3 bg-gray-400 dark:bg-gray-600" />}
						</div>
					))}
				</div>
			</PreviewFrame>
		),
	},
	{
		id: "filesystem",
		title: "Filesystem",
		icons: [Folder],
		renderPreview: () => (
			<PreviewFrame>
				<div className="flex flex-col gap-0.5 text-[7px] text-gray-500 dark:text-gray-400">
					<p>src/</p>
					<p className="pl-2">index.ts</p>
					<p className="pl-2">app/</p>
				</div>
			</PreviewFrame>
		),
	},
	{
		id: "terminal",
		title: "Terminal",
		icons: [TerminalSquare],
		renderPreview: () => (
			<PreviewFrame>
				<p className="font-mono text-[7px] text-success-50">$ <span className="text-gray-500 dark:text-gray-400">ready</span></p>
			</PreviewFrame>
		),
	},
	{
		id: "browser",
		title: "Browser",
		icons: [SiFirefox, SiGooglechrome],
		renderPreview: () => (
			<PreviewFrame>
				<div className="rounded border border-gray-300 dark:border-gray-600">
					<div className="h-1.5 rounded-t bg-gray-200 dark:bg-gray-700" />
					<div className="h-3 bg-white dark:bg-gray-800" />
				</div>
			</PreviewFrame>
		),
	},
	{
		id: "document-reader",
		title: "Document Reader",
		// Okular has no dedicated brand mark -- falls back to its parent project's (SiKde), per the settled discussion.
		icons: [SiKde],
		renderPreview: () => (
			<PreviewFrame>
				<div className="mx-auto flex h-6 w-4 flex-col gap-0.5 rounded-sm border border-gray-300 bg-white p-0.5 dark:border-gray-600 dark:bg-gray-800">
					<div className="h-0.5 w-full rounded-sm bg-gray-300 dark:bg-gray-600" />
					<div className="h-0.5 w-3/4 rounded-sm bg-gray-300 dark:bg-gray-600" />
					<div className="h-0.5 w-full rounded-sm bg-gray-300 dark:bg-gray-600" />
				</div>
			</PreviewFrame>
		),
	},
	{
		id: "photo-viewer",
		// Generic, no named app -- per the settled "Photo Viewer category" discussion.
		title: "Photo Viewer",
		icons: [ImageIcon],
		renderPreview: () => (
			<PreviewFrame>
				<div className="grid grid-cols-3 gap-0.5">
					{[0, 1, 2].map((tile) => (
						<div key={tile} className="aspect-square rounded-sm bg-accent-10 dark:bg-accent-80" />
					))}
				</div>
			</PreviewFrame>
		),
	},
	{
		id: "whiteboard",
		title: "Whiteboard",
		icons: [SiExcalidraw],
		renderPreview: () => (
			<PreviewFrame>
				<div className="relative h-6 w-10">
					<div className="absolute left-0 top-0 size-3 rounded-full border border-gray-400 dark:border-gray-500" />
					<div className="absolute right-0 bottom-0 size-3 rotate-6 border border-gray-400 dark:border-gray-500" />
				</div>
			</PreviewFrame>
		),
	},
];
