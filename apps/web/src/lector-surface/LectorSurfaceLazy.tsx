import { lazy, Suspense, useMemo } from "react";
import { resolveZodiacdBaseUrl } from "../platform/zodiacd-config.js";
import { createHttpContributionClient } from "./client.js";

const LectorSurfaceContent = lazy(() => import("./LectorSurface.js").then((module) => ({ default: module.LectorSurfaceContent })));

export function LectorSurfaceLazy(): React.JSX.Element {
	const client = useMemo(() => createHttpContributionClient(resolveZodiacdBaseUrl()), []);
	return <Suspense fallback={<div className="p-4 text-sm text-gray-500">Loading Lector…</div>}><LectorSurfaceContent client={client} /></Suspense>;
}
