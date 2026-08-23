import { lazy, Suspense, useMemo } from "react";
import { useRuntimeClientBundle } from "../platform/runtime-client-bundle-context.js";
import { createHttpVehicleSurfaceClient } from "./client.js";

const VehicleSurfaceContent = lazy(() => import("./VehicleSurface.js").then((module) => ({ default: module.VehicleSurfaceContent })));

export function PapyrusSurfaceLazy(): React.JSX.Element {
	const { zodiacdBaseUrl } = useRuntimeClientBundle();
	const client = useMemo(() => createHttpVehicleSurfaceClient({ baseUrl: zodiacdBaseUrl }), [zodiacdBaseUrl]);
	return <Suspense fallback={<div className="p-4 text-sm text-gray-500">Loading Papyrus…</div>}><VehicleSurfaceContent surfaceId="papyrus" client={client} /></Suspense>;
}
