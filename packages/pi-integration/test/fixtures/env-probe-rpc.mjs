#!/usr/bin/env node
// A minimal fixture used only by subprocess-agent-integration.test.ts's own
// env-injection test: emits one real, schema-valid "message_end" RPC event
// carrying this process's own PI_CODING_AGENT_DIR value as its assistant
// message text, so the test can assert on it via the same onEvent() path
// createSubprocessAgentIntegration's real consumers use -- never inspects
// the child process's env out of band.
process.stdout.write(
	`${JSON.stringify({
		type: "message_end",
		message: { role: "assistant", content: [{ type: "text", text: process.env.PI_CODING_AGENT_DIR ?? "" }] },
	})}\n`,
);
