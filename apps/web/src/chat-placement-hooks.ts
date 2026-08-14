import { useState } from "react";
import type { ChatPlacement } from "./platform/chat-placement.js";
import type { Preferences } from "./platform/preferences.js";

export interface ChatPlacementHandle {
	value: ChatPlacement;
	setPlacement: (value: ChatPlacement) => void;
}

/** Owns the current Chat placement (which edge of the center canvas Chat is docked to), persisted through Preferences -- mirrors useShapeSettings' own split. */
export function useChatPlacement(preferences: Preferences): ChatPlacementHandle {
	const [value, setValue] = useState<ChatPlacement>(() => preferences.chatPlacement());

	return {
		value,
		setPlacement(next) {
			setValue(next);
			preferences.setChatPlacement(next);
		},
	};
}
