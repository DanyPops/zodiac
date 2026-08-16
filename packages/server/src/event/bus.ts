/**
 * A small, framework-neutral, bounded in-process pub/sub bus with three
 * separate channels -- command, domain event, and UI notification.
 * Inspired by the channel split and correlationId/elapsed bookkeeping in
 * Alef's InProcessBus (~/Workspace/alef/packages/core/kernel/src/bus), but
 * written fresh for Zodiac: no Alef import, no shared code, and a
 * deliberately smaller surface (no dead-letter routing, no scoped BusView,
 * no watchdog -- the walking skeleton doesn't need them yet; see this
 * task's own Papyrus history for why those were left out of scope).
 *
 * The bus carries domain events from application Integrations and
 * bidirectional Agent Integrations to Web/TUI projections. It does not
 * replace Pi/Alef's own streams, does not authorize agent tool calls, and
 * is not a back-door command path -- an agent tool call still enters the
 * normal authorized command dispatcher; the resulting domain event then
 * publishes through this bus like any other mutation.
 *
 * Framework-neutral: no React, DOM, Pi, or Alef imports anywhere in this
 * module. Every subscription is bounded (see EventBusOptions) so a caller
 * that forgets to unsubscribe fails loudly and immediately as a typed
 * value, per this workspace's own resource-bounds convention, rather than
 * leaking listeners silently.
 */

export const BUS_CHANNELS = ["command", "event", "notification"] as const;

/** One of the three bus channels: command (request-shaped intent), event (observed domain mutation), notification (fire-and-forget UI signal). */
export type BusChannelName = (typeof BUS_CHANNELS)[number];

/** Subscription type that matches every message published on a channel, regardless of its own type. */
export const WILDCARD_TYPE = "*";

/** A message delivered on the bus, stamped with runtime timing metadata by publish(). */
export interface BusMessage {
	readonly type: string;
	readonly correlationId: string;
	readonly timestamp: number;
	readonly elapsed: number;
	readonly payload: unknown;
}

/** What a caller supplies to publish() -- timestamp/elapsed are stamped by the bus itself and can never be supplied by the caller. */
export type BusMessageInput = Omit<BusMessage, "timestamp" | "elapsed">;

/** A handler subscribed to one channel/type pair (or the wildcard type). Fire-and-forget: publish() does not swallow a thrown error -- it propagates synchronously to publish()'s own caller. */
export type BusHandler = (message: BusMessage) => void;

/** Deterministically stops delivering to the handler that returned it. Calling it more than once is a no-op. */
export type Unsubscribe = () => void;

/** The bus refused a subscription because the channel/type pair (or wildcard) is already at its listener cap -- a typed failure a caller must handle, never a thrown exception. */
export interface BusListenerLimitExceeded {
	readonly ok: false;
	readonly reason: "listener-limit-exceeded";
	readonly limit: number;
}

export type BusSubscribeResult = { readonly ok: true; readonly value: Unsubscribe } | BusListenerLimitExceeded;

export interface EventBusOptions {
	/** Maximum listeners per distinct (channel, type) pair, including the wildcard type, tracked independently. Default 100. */
	readonly maxListenersPerType?: number;
	/**
	 * Maximum number of distinct correlationIds this bus tracks a first-seen
	 * timestamp for (per channel), used to compute BusMessage.elapsed. Bounded
	 * so a long-lived process publishing an unbounded stream of correlationIds
	 * can't leak memory; the oldest tracked correlation is evicted silently --
	 * this is bookkeeping cleanup, not a caller-facing failure. Default 500.
	 */
	readonly maxTrackedCorrelations?: number;
}

export interface EventBus {
	/**
	 * Publishes one message on a channel. Delivers first to every handler
	 * subscribed to the message's exact type (in subscription order), then
	 * to every wildcard handler on that channel (in subscription order).
	 */
	publish(channel: BusChannelName, message: BusMessageInput): void;
	/** Subscribes to one message type on one channel. Returns a typed failure instead of throwing if the channel/type pair is already at its listener cap. */
	subscribe(channel: BusChannelName, type: string, handler: BusHandler): BusSubscribeResult;
	/** Subscribes to every message published on a channel, regardless of type. Subject to the same per-(channel, wildcard) listener cap as subscribe(). */
	onAny(channel: BusChannelName, handler: BusHandler): BusSubscribeResult;
	/** The current listener count for a channel/type pair (or the wildcard type). */
	listenerCount(channel: BusChannelName, type: string): number;
}

const DEFAULT_MAX_LISTENERS_PER_TYPE = 100;
const DEFAULT_MAX_TRACKED_CORRELATIONS = 500;

function createChannelMap<T>(factory: () => T): Record<BusChannelName, T> {
	return { command: factory(), event: factory(), notification: factory() };
}

export function createEventBus(options: EventBusOptions = {}): EventBus {
	const maxListenersPerType = options.maxListenersPerType ?? DEFAULT_MAX_LISTENERS_PER_TYPE;
	const maxTrackedCorrelations = options.maxTrackedCorrelations ?? DEFAULT_MAX_TRACKED_CORRELATIONS;

	// One handler-set map per channel, keyed by message type ("*" for wildcard).
	const handlersByChannel = createChannelMap<Map<string, Set<BusHandler>>>(() => new Map());

	// Bounded first-seen-timestamp bookkeeping per channel, for BusMessage.elapsed.
	const firstSeenByChannel = createChannelMap<Map<string, number>>(() => new Map());

	function firstSeenAt(channel: BusChannelName, correlationId: string, now: number): number {
		const tracked = firstSeenByChannel[channel];
		const existing = tracked.get(correlationId);
		if (existing !== undefined) return existing;
		tracked.set(correlationId, now);
		if (tracked.size > maxTrackedCorrelations) {
			const oldestKey: string | undefined = tracked.keys().next().value;
			if (oldestKey !== undefined) tracked.delete(oldestKey);
		}
		return now;
	}

	function handlerSet(channel: BusChannelName, type: string): Set<BusHandler> {
		const byType = handlersByChannel[channel];
		let set = byType.get(type);
		if (!set) {
			set = new Set();
			byType.set(type, set);
		}
		return set;
	}

	function subscribeTo(channel: BusChannelName, type: string, handler: BusHandler): BusSubscribeResult {
		const set = handlerSet(channel, type);
		if (set.size >= maxListenersPerType) {
			return { ok: false, reason: "listener-limit-exceeded", limit: maxListenersPerType };
		}
		set.add(handler);
		let active = true;
		return {
			ok: true,
			value: () => {
				if (!active) return;
				active = false;
				set.delete(handler);
			},
		};
	}

	return {
		publish(channel, input) {
			const now = Date.now();
			const startedAt = firstSeenAt(channel, input.correlationId, now);
			const message: BusMessage = { ...input, timestamp: now, elapsed: now - startedAt };
			const specific = handlersByChannel[channel].get(message.type);
			if (specific) for (const handler of specific) handler(message);
			const wildcard = handlersByChannel[channel].get(WILDCARD_TYPE);
			if (wildcard) for (const handler of wildcard) handler(message);
		},
		subscribe(channel, type, handler) {
			return subscribeTo(channel, type, handler);
		},
		onAny(channel, handler) {
			return subscribeTo(channel, WILDCARD_TYPE, handler);
		},
		listenerCount(channel, type) {
			return handlersByChannel[channel].get(type)?.size ?? 0;
		},
	};
}
