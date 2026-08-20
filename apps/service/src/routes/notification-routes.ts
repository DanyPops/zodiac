import type { IncomingMessage, ServerResponse } from "node:http";
import type { EventBus } from "@zodiac/server";
import type { ApprovalCenter } from "@zodiac/server/approval";
import { writeSseFrame } from "./sse-writer.js";

function writeJson(res: ServerResponse, status: number, body: unknown): void {
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json");
	res.setHeader("Cache-Control", "no-store");
	res.end(JSON.stringify(body));
}

/**
 * The live daemon->browser half of the Notifications surface (per the "Wire a live
 * daemon->browser notification transport" Papyrus Task). Before this, ApprovalCenter/EventBus
 * were real and tested but never constructed in the running zodiacd, and no route exposed the
 * bus's "notification" channel at all -- NotificationsPill.tsx's own doc comment named this gap
 * explicitly ("a parent wires this component to that daemon state once the live SSE/HTTP surface
 * for it exists").
 *
 * GET streams the channel as SSE, resyncing a late-joining client with the current pending list
 * as its own first frame -- same reconnect-resync discipline as world-routes.ts's own
 * streamEvents, so a client that connects after a request is already pending still sees it.
 * POST approve/deny are thin transport wrappers over ApprovalCenter's own already-real,
 * already-tested domain methods -- this file adds zero new domain logic.
 */
export function createNotificationRoutes(bus: EventBus, approvalCenter: ApprovalCenter, options?: { maxSseBufferedBytes?: number }) {
	const maxSseBufferedBytes = options?.maxSseBufferedBytes;
	return {
		streamNotifications(req: IncomingMessage, res: ServerResponse): void {
			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-store",
				Connection: "keep-alive",
			});
			res.flushHeaders();
			if (!writeSseFrame(res, { type: "notifications.snapshot", pending: approvalCenter.pending() }, maxSseBufferedBytes)) return;
			const subscribed = bus.onAny("notification", (message) => {
				// See sse-writer.ts's own doc comment (grounded in opencode's real 187GB RSS
				// incident) -- a per-connection close on a slow client, never daemon-wide.
				if (!writeSseFrame(res, message, maxSseBufferedBytes) && subscribed.ok) subscribed.value();
			});
			if (!subscribed.ok) {
				// Bounded per EventBus's own per-(channel, wildcard) listener cap -- fail loudly and
				// close rather than serve a client that will never see a live update, matching this
				// workspace's own resource-bounds convention (see EventBus's own doc comment).
				res.end();
				return;
			}
			req.on("close", () => subscribed.value());
		},

		/** Thin wrapper over ApprovalCenter.approve() -- 404 (not 200-with-null) for a requestId that isn't currently pending, so a caller can distinguish "nothing to approve" from a real success. */
		postApprove(_req: IncomingMessage, res: ServerResponse, requestId: string): void {
			const capability = approvalCenter.approve(requestId);
			if (capability === undefined) {
				writeJson(res, 404, { code: "not-pending", message: `No pending approval request "${requestId}".` });
				return;
			}
			writeJson(res, 200, { capability });
		},

		/** Thin wrapper over ApprovalCenter.deny() -- always 200 (deny() is itself a documented no-op for an already-resolved requestId, not an error). */
		postDeny(_req: IncomingMessage, res: ServerResponse, requestId: string): void {
			approvalCenter.deny(requestId);
			writeJson(res, 200, { ok: true });
		},
	};
}
