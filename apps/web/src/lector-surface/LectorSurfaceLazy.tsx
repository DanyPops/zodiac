import { lazy, Suspense, useMemo } from "react";
import { useRuntimeClientBundle } from "../platform/runtime-client-bundle-context.js";
import { createHttpContributionClient } from "./client.js";

const LectorSurfaceContent = lazy(() => import("./LectorSurface.js").then((module) => ({ default: module.LectorSurfaceContent })));

export function LectorSurfaceLazy(): React.JSX.Element {
	const { zodiacdBaseUrl } = useRuntimeClientBundle();
	const client = useMemo(() => createHttpContributionClient(zodiacdBaseUrl), [zodiacdBaseUrl]);
	return <Suspense fallback={<div className="p-4 text-sm text-gray-500">Loading Lector…</div>}><LectorSurfaceContent client={client} /></Suspense>;
}
