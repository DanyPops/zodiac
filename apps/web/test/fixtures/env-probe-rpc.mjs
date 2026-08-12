#!/usr/bin/env node
// A minimal fixture used only by process-rpc-session.test.ts's own env-
// injection test: emits one real, schema-valid RPC "response" event whose
// `error` string field carries this process's own PI_CODING_AGENT_DIR value
// (empty string if unset), so the test can assert on it via the same
// onEvent() path spawnPiRpcSession's real consumers use -- never inspects
// the child process's env out of band.
process.stdout.write(
	`${JSON.stringify({ type: "response", command: "env-probe", success: true, error: process.env.PI_CODING_AGENT_DIR ?? "" })}\n`,
);
