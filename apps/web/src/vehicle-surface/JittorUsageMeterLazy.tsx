import { lazy, Suspense, useMemo } from "react";
import { useRuntimeClientBundle } from "../platform/runtime-client-bundle-context.js";
import { createHttpVehicleSurfaceClient } from "./client.js";

const JittorUsageMeter = lazy(() => import("./JittorUsageMeter.js").then((module) => ({ default: module.JittorUsageMeter })));

/** Keeps @danypops/jittor/usage's own (small, but real) code out of the entry bundle -- same rationale as PapyrusSurfaceLazy/LectorSurfaceLazy. Renders nothing while loading; the meter itself already renders nothing until its first real poll resolves, so there's no extra loading-flash to suppress here. */
export function JittorUsageMeterLazy(): React.JSX.Element {
	const { zodiacdBaseUrl } = useRuntimeClientBundle();
	const client = useMemo(() => createHttpVehicleSurfaceClient({ baseUrl: zodiacdBaseUrl }), [zodiacdBaseUrl]);
	return <Suspense fallback={undefined}><JittorUsageMeter client={client} /></Suspense>;
}
