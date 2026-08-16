import { useEffect, useRef } from "react";
import type { WorldViewModel } from "@zodiac/protocol";
import type { WorkspaceLifecycleEvent } from "../extensions/types.js";
import { diffWorldViewModels } from "./world-diff-events.js";

/**
 * Fans a live WorldViewModel's own successive changes out to an
 * ExtensionHost's emit(), via diffWorldViewModels -- the daemon-backed
 * equivalent of useWorkspaceRegistry.ts's own imperative emit() call
 * sites. An extension's own `on()` consumer contract (apps/web/src/extensions)
 * stays unchanged; it never needs to know the data source moved.
 */
export function useWorldExtensionEvents(viewModel: WorldViewModel, emit: (event: WorkspaceLifecycleEvent) => void): void {
	const previousRef = useRef<WorldViewModel | undefined>(undefined);

	useEffect(() => {
		const previous = previousRef.current;
		previousRef.current = viewModel;
		if (previous === undefined) return; // first frame -- nothing to diff against yet
		for (const event of diffWorldViewModels(previous, viewModel)) emit(event);
	}, [viewModel, emit]);
}
