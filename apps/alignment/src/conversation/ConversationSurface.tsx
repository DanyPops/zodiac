import { Send, Wrench } from "lucide-react";
import type { ConversationItem } from "./projector.js";
import { CommandButton } from "../commands/react.js";
import { cn } from "../platform/cn.js";
import { SURFACE_BG } from "../platform/surface-style.js";

interface ConversationSurfaceProps {
	readonly items: readonly ConversationItem[];
	readonly loading: boolean;
	readonly error?: string;
	readonly draft: string;
	readonly onDraftChange: (value: string) => void;
	readonly onComposerFocus: () => void;
}

export function ConversationSurface({ items, loading, error, draft, onDraftChange, onComposerFocus }: ConversationSurfaceProps): React.JSX.Element {
	return (
		<div className={cn("flex h-full min-h-0 flex-col", SURFACE_BG)}>
			<div role="log" aria-label="AI conversation" aria-live="polite" className="min-h-0 flex-1 overflow-auto px-5 py-4">
				{loading && <p className="text-sm text-gray-600 dark:text-gray-300">Loading conversation…</p>}
				{error && <p className="rounded-lg border border-danger-50 bg-danger-10 px-3 py-2 text-sm text-danger-80">{error}</p>}
				{!loading && !error && items.length === 0 && <p className="text-sm text-gray-600 dark:text-gray-300">This conversation has no renderable events.</p>}
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
					{items.map((item, index) => (
						<ConversationRow key={`${item.timestamp}:${item.kind}:${index}`} item={item} />
					))}
				</div>
			</div>
			<Composer draft={draft} onDraftChange={onDraftChange} onComposerFocus={onComposerFocus} />
		</div>
	);
}

interface ComposerProps {
	readonly draft: string;
	readonly onDraftChange: (value: string) => void;
	readonly onComposerFocus: () => void;
}

/**
 * The prompt box, extracted so the Chat Surface's collapsed "peek" state
 * (last reply + composer, no full transcript) can reuse it without
 * duplicating markup. Edge-to-edge within its own `p-3` -- no separate
 * `mx-auto max-w-3xl` inset, which used to insert it relative to the wider
 * Chat pillar and desync its left/right edges from ChatOverlay's collapsed
 * "Last reply" row above it (that row's own padding is matched to this
 * one's p-3, not centered independently).
 */
export function Composer({ draft, onDraftChange, onComposerFocus }: ComposerProps): React.JSX.Element {
	return (
		<div className="shrink-0 border-t border-gray-200 bg-white/95 p-3 backdrop-blur dark:border-gray-700 dark:bg-gray-800/95">
			<p className="mb-1.5 text-[10px] text-gray-600 dark:text-gray-300">Fixture preview — Alef write path is not connected.</p>
			<div className="flex items-stretch gap-2 rounded-xl border border-gray-300 bg-white p-2 shadow-sm focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-20 dark:border-gray-600 dark:bg-gray-800 dark:focus-within:ring-accent-70">
				<textarea
					aria-label="Message Alef"
					rows={2}
					value={draft}
					onFocus={onComposerFocus}
					onChange={(event) => onDraftChange(event.target.value)}
					placeholder="Message Alef"
					className="max-h-36 min-h-10 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-gray-900 outline-none placeholder:text-gray-500 dark:text-gray-100 dark:placeholder:text-gray-400"
				/>
				{/* w-9 + self-stretch, not a fixed size-9 square -- its height tracks the row's actual height (the textarea can grow up to max-h-36), matching the composer's own height instead of a hardcoded one. */}
				<CommandButton
					commandId="conversation.send"
					label="Send message"
					disabled={!draft.trim()}
					className="grid w-9 shrink-0 place-items-center self-stretch rounded-lg bg-accent text-white hover:bg-accent-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
				>
					<Send aria-hidden="true" size={16} />
				</CommandButton>
			</div>
		</div>
	);
}

export function ConversationRow({ item }: { readonly item: ConversationItem }): React.JSX.Element {
	if (item.kind === "message") {
		const user = item.role === "user";
		return (
			<div className={`flex ${user ? "justify-end" : "justify-start"}`}>
				<div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm leading-6 ${user ? "bg-accent-10 text-accent-80 dark:bg-accent-70 dark:text-accent-10" : "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100"}`}>
					<span className="sr-only">{user ? "User" : "Alef"}: </span>
					{item.text}
				</div>
			</div>
		);
	}
	if (item.kind === "turn-marker") {
		return <p className="px-1 text-xs text-gray-600 dark:text-gray-300">Alef used {item.toolCallCount} tool{item.toolCallCount === 1 ? "" : "s"}.</p>;
	}
	if (item.kind === "tool-call") {
		return (
			<details className="rounded-lg border border-gray-200 bg-gray-50 text-sm dark:border-gray-700 dark:bg-gray-800">
				<summary className="flex cursor-pointer items-center gap-2 px-3 py-2 font-medium text-gray-700 dark:text-gray-200">
					<Wrench aria-hidden="true" size={14} />
					{item.toolName}
				</summary>
				<div className="grid gap-3 border-t border-gray-200 p-3 text-xs dark:border-gray-700 md:grid-cols-2">
					<Payload label="Request" value={item.request} />
					<Payload label="Response" value={item.response} />
				</div>
			</details>
		);
	}
	return (
		<div className="rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">
			<code>{item.bus}/{item.type}</code>
		</div>
	);
}

function Payload({ label, value }: { readonly label: string; readonly value: unknown }): React.JSX.Element {
	return (
		<div className="min-w-0">
			<p className="mb-1 font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">{label}</p>
			<pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 text-gray-800 dark:bg-gray-950 dark:text-gray-200">
				{value === undefined ? "Pending" : JSON.stringify(value, null, 2)}
			</pre>
		</div>
	);
}
