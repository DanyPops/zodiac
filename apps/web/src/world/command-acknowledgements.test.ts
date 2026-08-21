import { describe, expect, it } from "vitest";
import { commandId } from "@zodiac/protocol";
import { MAX_RETAINED_COMMAND_ACKNOWLEDGEMENTS, recordCommandAcknowledgement } from "./command-acknowledgements.js";

describe("recordCommandAcknowledgement", () => {
	it("records each command once without depending on a World entity change", () => {
		const once = recordCommandAcknowledgement([], commandId("cmd-1"));
		expect(recordCommandAcknowledgement(once, commandId("cmd-1"))).toEqual(["cmd-1"]);
	});

	it("keeps a bounded recent acknowledgement window", () => {
		let current = [] as readonly ReturnType<typeof commandId>[];
		for (let index = 0; index <= MAX_RETAINED_COMMAND_ACKNOWLEDGEMENTS; index += 1) {
			current = recordCommandAcknowledgement(current, commandId(`cmd-${index}`));
		}
		expect(current).toHaveLength(MAX_RETAINED_COMMAND_ACKNOWLEDGEMENTS);
		expect(current[0]).toBe("cmd-1");
	});
});
