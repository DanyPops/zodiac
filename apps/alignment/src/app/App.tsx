import type { Position } from "dockview-react";
import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { CommandDialog } from "../commands/CommandDialog.js";
import { createAlignmentCommandRegistry } from "../commands/defaults.js";
import { CommandProvider } from "../commands/react.js";
import { useCommandContextStack } from "../commands/useCommandContextStack.js";
import { useKeybindingOverrides } from "../commands/useKeybindingOverrides.js";
import { createHttpConversationClient } from "../conversation/client.js";
import { useConversationWorkspace } from "../conversation/useConversationWorkspace.js";
import { createPreferences } from "../platform/preferences.js";
import { createWindowPointerTracker } from "../platform/pointer.js";
import { useTheme } from "../theme-hooks.js";
import { ChatOverlay } from "../workspace/ChatOverlay.js";
import { findSurfaceTemplate } from "../workspace/surface-templates.js";
import { SurfaceTemplatesPillar } from "../workspace/SurfaceTemplatesPillar.js";
import { TemplatesDialog } from "../workspace/TemplatesDialog.js";
import { useChatVisibility } from "../workspace/useChatVisibility.js";
import { useConversationListNavigation } from "../workspace/useConversationListNavigation.js";
import { useSurfaceTemplates } from "../workspace/useSurfaceTemplates.js";
import { useWorkspace } from "../workspace/useWorkspace.js";
import { useWorkspaceSelectionCollapse } from "../workspace/useWorkspaceSelectionCollapse.js";
import { WindowCarousel } from "../workspace/WindowCarousel.js";
import type { PendingDock } from "../workspace/WindowDockview.js";
import { WorkspaceSelection } from "../workspace/WorkspaceSelection.js";

const conversationClient = createHttpConversationClient();

// The docking engine (dockview-react + its CSS theme) is a real ~80kB gzip
// dependency -- split into its own chunk so the core shell (Workspace
// Selection, Window Carousel, Chat, command palette) becomes interactive
// without waiting on it first.
const WindowDockview = lazy(() => import("../workspace/WindowDockview.js").then((module) => ({ default: module.WindowDockview })));

export function App(): React.JSX.Element {
	const preferences = useMemo(() => createPreferences(window.localStorage), []);
	const pointerTracker = useMemo(() => createWindowPointerTracker(), []);
	const theme = useTheme();
	const selection = useWorkspaceSelectionCollapse(preferences);
	const contexts = useCommandContextStack();
	const keybindings = useKeybindingOverrides(preferences);
	const conversationWorkspace = useConversationWorkspace(conversationClient);
	const workspace = useWorkspace(conversationWorkspace.selectedConversationId ?? "pending");
	const surfaceTemplates = useSurfaceTemplates(preferences);
	const [draft, setDraft] = useState("");
	const [pendingDock, setPendingDock] = useState<PendingDock | undefined>(undefined);
	const [activeDockedInstanceId, setActiveDockedInstanceId] = useState<string | undefined>(undefined);

	const chatVisibility = useChatVisibility({ visible: workspace.workspace.chatVisible, show: workspace.showChat, hide: workspace.hideChat, pointerTracker });

	const selectedButtonRef = useRef<HTMLButtonElement>(null);
	const selectionRef = useRef<HTMLElement>(null);
	const canvasRef = useRef<HTMLElement>(null);
	const conversationNavigation = useConversationListNavigation(selectionRef);

	function focusSelectedConversationButton(): void {
		requestAnimationFrame(() => selectedButtonRef.current?.focus());
	}

	function dockTemplate(templateId: string, title: string, position: Position | undefined, referenceGroupId?: string): void {
		const instance = workspace.dockSurface(templateId, title);
		setPendingDock({ instanceId: instance.id, position, referenceGroupId });
	}

	const activeTemplateId = workspace.activeWindow.dockedSurfaces.find((surface) => surface.id === activeDockedInstanceId)?.templateId;

	const registry = createAlignmentCommandRegistry(
		{
			toggleWorkspaceSelection() {
				if (selection.toggle()) {
					contexts.enterSurface();
					return;
				}
				contexts.enterWorkspaceSelection();
				focusSelectedConversationButton();
			},
			focusWorkspaceSelection() {
				selection.expand();
				contexts.enterWorkspaceSelection();
				focusSelectedConversationButton();
			},
			focusCanvas() {
				canvasRef.current?.focus();
				contexts.enterCanvas();
			},
			focusPreviousConversation: conversationNavigation.focusPrevious,
			focusNextConversation: conversationNavigation.focusNext,
			focusFirstConversation: conversationNavigation.focusFirst,
			focusLastConversation: conversationNavigation.focusLast,
			cycleTheme: theme.cycleTheme,
			sendMessage() {
				const text = draft.trim();
				if (!text) return;
				conversationWorkspace.appendUserMessage(text);
				setDraft("");
			},
			openPalette: () => contexts.openDialog("palette"),
			openShortcuts: () => contexts.openDialog("shortcuts"),
			closeDialog: () => contexts.closeDialog(),
			openConversation(conversationId) {
				conversationWorkspace.openConversation(typeof conversationId === "string" ? conversationId : undefined);
			},
			canSendMessage: () => draft.trim().length > 0,
			nextWindow: workspace.nextWindow,
			previousWindow: workspace.previousWindow,
			newWindow: workspace.addWindow,
			toggleChat: workspace.toggleChat,
			openTemplatesPicker: () => contexts.openDialog("templates"),
			dockDefaultTemplate(templateId) {
				if (!templateId) return;
				const template = findSurfaceTemplate(templateId);
				if (template) dockTemplate(templateId, template.title, undefined);
			},
		},
		keybindings.userBindings,
	);

	return (
		<CommandProvider registry={registry} activeContexts={contexts.effectiveContexts}>
			<div className="relative flex h-dvh min-h-[32rem] overflow-hidden" data-workspace-id={workspace.workspace.id}>
				<WorkspaceSelection
					collapsed={selection.collapsed}
					conversations={conversationWorkspace.conversations}
					selectedConversationId={conversationWorkspace.selectedConversationId}
					loading={conversationWorkspace.conversationsLoading}
					selectionRef={selectionRef}
					selectedButtonRef={selectedButtonRef}
					onConversationFocus={(id) => {
						conversationWorkspace.notifyConversationFocused(id);
						contexts.enterWorkspaceSelection();
					}}
				/>

				<div className="flex min-w-0 flex-1 flex-col">
					<WindowCarousel windowCount={workspace.workspace.windows.length} activeIndex={workspace.workspace.activeWindowIndex} onSelect={workspace.selectWindow} />
					<section
						ref={canvasRef}
						tabIndex={-1}
						onFocus={(event) => {
							if (event.currentTarget === event.target) contexts.enterCanvas();
						}}
						aria-label="Window view"
						className="min-h-0 flex-1 bg-gray-100 outline-none dark:bg-gray-950"
					>
						<Suspense fallback={<div className="grid h-full place-items-center text-sm text-gray-500 dark:text-gray-400">Loading Window…</div>}>
							<WindowDockview
								windowId={workspace.activeWindow.id}
								dockedSurfaces={workspace.activeWindow.dockedSurfaces}
								pendingDock={pendingDock}
								onPendingDockConsumed={() => setPendingDock(undefined)}
								onPanelClosed={workspace.undockSurface}
								onExternalTemplateDrop={(templateId, position, referenceGroupId) => {
									const template = findSurfaceTemplate(templateId);
									if (template) dockTemplate(templateId, template.title, position, referenceGroupId);
								}}
								onActivePanelChange={setActiveDockedInstanceId}
								isDark={theme.isDark}
							/>
						</Suspense>
					</section>
				</div>

				<SurfaceTemplatesPillar
					entries={surfaceTemplates.entries}
					onDockDefault={(templateId, title) => dockTemplate(templateId, title, undefined)}
					canSaveCurrent={activeTemplateId !== undefined}
					onSaveCurrentAsTemplate={(title) => {
						if (activeTemplateId) surfaceTemplates.saveAsTemplate(title, activeTemplateId);
					}}
				/>

				<ChatOverlay
					visible={workspace.workspace.chatVisible}
					onPointerEnter={chatVisibility.onPointerEnter}
					onPointerLeave={chatVisibility.onPointerLeave}
					onFocusCapture={chatVisibility.onFocusCapture}
					onBlurCapture={chatVisibility.onBlurCapture}
					conversationItems={conversationWorkspace.conversationItems}
					conversationLoading={conversationWorkspace.conversationLoading}
					conversationError={conversationWorkspace.conversationError}
					draft={draft}
					onDraftChange={setDraft}
					onComposerFocus={contexts.enterTextInput}
				/>

				<CommandDialog
					mode={contexts.dialogMode}
					onModeChange={(mode) => {
						contexts.openDialog(mode);
						if (!mode) contexts.enterGlobal();
					}}
					onRebind={(commandId, hotkey) => keybindings.rebind(commandId, hotkey, registry.commands())}
				/>
				<TemplatesDialog
					open={contexts.dialogMode === "templates"}
					onClose={() => {
						contexts.closeDialog();
						contexts.enterGlobal();
					}}
					entries={surfaceTemplates.entries}
					onDock={(templateId, title, position) => dockTemplate(templateId, title, position)}
				/>
			</div>
		</CommandProvider>
	);
}
