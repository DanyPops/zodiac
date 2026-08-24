import { useEffect, useState } from "react";
import { buildCostGraph, buildUsageGraph, resolveUsageWindow, type CostGraph, type UsageGraph } from "@danypops/jittor/usage";
import type { VehicleSurfaceClient } from "./client.js";

/**
 * Live recent token/cost usage, sourced from the real Jittor daemon through
 * the generic Vehicle Surface Gateway -- no bespoke Zodiac-side token
 * accounting; the aggregation math (buildUsageGraph/buildCostGraph) is
 * reused verbatim from @danypops/jittor, only the rendering is new.
 *
 * Scoped to "recent activity across every session" (source: "pi", a fixed
 * lookback window), not one specific Workspace/agent session -- Jittor's
 * own metric scope model aggregates by provider:model, not by a Zodiac
 * Workspace/session id, and there is no existing correlation between the
 * two today. A genuinely per-session view (this task's own further-scoped
 * ambition) needs that correlation built first; disclosed as follow-on
 * work, not silently faked here.
 *
 * Poll, not push (explicit decision, not a silent default): confirmed
 * directly against @danypops/jittor's own src/vehicle/ -- it has no
 * subscribe/invalidate hooks today, unlike Papyrus's own Vehicle (which
 * this session already gave a real push channel). Polling is a real,
 * immediately-available "one-afternoon win"; a genuine push channel would
 * need new Jittor-repo infrastructure mirroring Papyrus's own
 * task-mutation-push.ts, deferred as separate, larger work.
 */
const POLL_INTERVAL_MS = 15_000;
/** "hourly" (resolveUsageWindow's own period) is the 1-hour lookback window; this only overrides its default bucket count. */
const BUCKET_COUNT = 12;

export interface JittorUsageMeterProps {
	readonly client: VehicleSurfaceClient;
	/** Injectable for tests. Defaults to the real clock. */
	readonly now?: () => number;
}

interface UsageSnapshot {
	readonly usage: UsageGraph;
	readonly cost: CostGraph;
}

async function fetchSnapshot(client: VehicleSurfaceClient, now: number): Promise<UsageSnapshot | undefined> {
	const window = resolveUsageWindow("hourly", now, BUCKET_COUNT);
	const result = await client.invoke("jittor", { name: "metrics.usage_series", version: 1, input: { source: "pi", since: window.start, until: window.end, bucketSizeMs: window.bucketSizeMs, bucketCount: window.bucketCount } });
	if (!result.ok) return undefined;
	const { rows, truncated } = result.output as { rows: Parameters<typeof buildUsageGraph>[0]; truncated: boolean };
	return { usage: buildUsageGraph(rows, window, { period: "hourly", truncated }), cost: buildCostGraph(rows, window, { period: "hourly", truncated }) };
}

function formatTokens(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
	return String(Math.round(count));
}

function formatUsd(amount: number): string {
	if (amount === 0) return "$0";
	if (amount < 0.01) return "<$0.01";
	return `$${amount.toFixed(2)}`;
}

/** Compact, single-line badge -- the Chat header (WindowDockview's own "Aware of:" row) has no room for a full chart; a historical period-by-period view is real, disclosed follow-on scope, not this component's own job. */
export function JittorUsageMeter({ client, now = () => Date.now() }: JittorUsageMeterProps): React.JSX.Element | undefined {
	const [snapshot, setSnapshot] = useState<UsageSnapshot | undefined>(undefined);
	const [unavailable, setUnavailable] = useState(false);

	useEffect(() => {
		let disposed = false;
		async function poll(): Promise<void> {
			try {
				const next = await fetchSnapshot(client, now());
				if (!disposed) { setSnapshot(next); setUnavailable(next === undefined); }
			} catch {
				if (!disposed) setUnavailable(true);
			}
		}
		void poll();
		const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
		return () => { disposed = true; clearInterval(interval); };
		// eslint-disable-next-line react-hooks/exhaustive-deps -- `now` is a test seam, not a reactive dependency; re-polling on every render it happens to produce a new closure for would defeat the whole point of the interval.
	}, [client]);

	// No snapshot yet (still loading) and no confirmed-unavailable state: render nothing rather
	// than a placeholder that would just flash once real data arrives moments later.
	if (unavailable) return <span className="text-[10px] text-gray-400 dark:text-gray-500" title="Jittor usage meter unavailable">usage: unavailable</span>;
	if (!snapshot) return undefined;
	if (snapshot.usage.totalTokens === 0 && snapshot.cost.totalUsd === 0) return <span className="text-[10px] text-gray-400 dark:text-gray-500">no recent usage</span>;
	return (
		<span className="whitespace-nowrap text-[10px] text-gray-500 dark:text-gray-400" title="Recent (last hour) token/cost usage, from Jittor">
			{formatTokens(snapshot.usage.totalTokens)} tok · {formatUsd(snapshot.cost.totalUsd)}
		</span>
	);
}
