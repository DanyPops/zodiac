import type { CommandId } from "@zodiac/protocol";

export const MAX_RETAINED_COMMAND_ACKNOWLEDGEMENTS = 256;

/** Records accepted command correlation independently of the entity shape a World mutation happened to change. */
export function recordCommandAcknowledgement(current: readonly CommandId[], commandId: CommandId | undefined): readonly CommandId[] {
	if (commandId === undefined || current.includes(commandId)) return current;
	const next = [...current, commandId];
	return next.length <= MAX_RETAINED_COMMAND_ACKNOWLEDGEMENTS ? next : next.slice(-MAX_RETAINED_COMMAND_ACKNOWLEDGEMENTS);
}
