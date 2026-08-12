/** Shared layout wrapper for a gallery category's per-category preview mockup -- its own file so gallery-categories.tsx (data + JSX factories) can stay a plain data module for react-refresh's own component-file convention. */
export function GalleryPreviewFrame({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
	return <div className="flex h-full w-full flex-col justify-center gap-1 px-3 text-left">{children}</div>;
}
