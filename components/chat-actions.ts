import { createContext } from "react";

/**
 * Server-sync channel for artifact renderers: the CENTRAL jobs poll in Chat
 * calls syncFromServer() when a background job settles — the wake turn's
 * steer + response are already persisted by then, so fresh messages replace
 * local state in one pull. sendText feeds the demo error-fix loop.
 * (contracts.ts "THE ASYNC PROTOCOL" §4.)
 *
 * Lives in its own module (2026-11-09) so markdown renderers (the kline
 * block's error card) can read it without importing all of chat.tsx;
 * chat.tsx re-exports it for its existing importers.
 */
export const ChatActionsContext = createContext<{
	chatId: string;
	syncFromServer: () => Promise<void>;
	/** Send a user message into the session (demo error-fix loop, W6). */
	sendText: (text: string) => void;
	/** Opens the model setup dialog (BYOK, 2026-09-22): refused job cards
	 *  deep-link into the same SetupDialog the send interception uses. */
	openSetup: () => void;
} | null>(null);
