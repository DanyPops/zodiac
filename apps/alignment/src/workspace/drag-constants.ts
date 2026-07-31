/**
 * Split out from WindowDockview.tsx: a plain string constant that
 * SurfaceTemplatesPillar (mounted immediately) also needs. Re-exporting it
 * from WindowDockview would force a static import of that module -- and
 * everything it pulls in, including dockview-react -- defeating the point of
 * lazy-loading the docking engine in App.tsx.
 */
export const TEMPLATE_DRAG_MIME_TYPE = "application/x-alignment-surface-template";
