/**
 * Synthetic but realistic mock data for the tiling primitives playground.
 *
 * "Realistic" means: field names and enums are copied from the real Go
 * domain types at ~/Workspace/conty (CI) and ~/Workspace/emcee (tickets,
 * PRs) -- structural shape only. Content is entirely fictional: a made-up
 * product ("Northwind", a placeholder-style name with no relation to any
 * real company, project, or system) with made-up repos, ticket numbers,
 * job names, and commands. No real internal names, ticket numbers, repo
 * names, or job names appear anywhere in this file.
 */

// ---------------------------------------------------------------------------
// CI -- shape matches ~/Workspace/conty internal/domain/ci.go + status.go
// ---------------------------------------------------------------------------

export type RunStatus = "pending" | "running" | "success" | "failure" | "aborted" | "not_found";

export interface CIStep {
	id: string;
	name: string;
	status: RunStatus;
	durationMs?: number;
}

export interface CIStageNode {
	id: string;
	name: string;
	status: RunStatus;
	durationMs?: number;
	steps?: CIStep[];
}

export interface CIRun {
	id: string;
	name: string;
	status: RunStatus;
	startedAt: string;
	durationMs?: number;
	url?: string;
	stages: CIStageNode[];
}

export function mockCIRuns(): CIRun[] {
	return [
		{
			id: "northwind-integration-4127",
			name: "northwind-integration-tests",
			status: "running",
			startedAt: "2026-07-21T09:12:00Z",
			durationMs: 41 * 60 * 1000,
			url: "https://ci.example.internal/job/northwind-integration-tests/4127/",
			stages: [
				{ id: "deploy", name: "Deploy", status: "success", durationMs: 8 * 60 * 1000 },
				{ id: "unit-tests", name: "Unit Tests", status: "success", durationMs: 6 * 60 * 1000 },
				{ id: "integration", name: "Integration", status: "success", durationMs: 4 * 60 * 1000 },
				{
					id: "sync-suite",
					name: "Run sync suite",
					status: "running",
					durationMs: 23 * 60 * 1000,
					steps: [
						{ id: "beacon-failover", name: "Beacon failover", status: "success", durationMs: 6 * 60 * 1000 },
						{ id: "relay-handoff", name: "Relay handoff", status: "success", durationMs: 5 * 60 * 1000 },
						{ id: "dual-node", name: "Dual-node sync", status: "running" },
						{ id: "signal-loss", name: "Signal loss recovery", status: "pending" },
					],
				},
				{ id: "reporting", name: "Reporting", status: "pending" },
			],
		},
		{
			id: "northwind-regression-891",
			name: "northwind-regression-suite",
			status: "failure",
			startedAt: "2026-07-21T06:00:00Z",
			durationMs: 5 * 3600 * 1000 + 18 * 60 * 1000,
			url: "https://ci.example.internal/job/northwind-regression-suite/891/",
			stages: [
				{ id: "load-validation", name: "Load Validation", status: "failure", durationMs: 12 * 60 * 1000 },
				{ id: "stability", name: "Stability (no workload)", status: "aborted" },
			],
		},
		{
			id: "northwind-integration-4126",
			name: "northwind-integration-tests",
			status: "success",
			startedAt: "2026-07-20T00:03:00Z",
			durationMs: 58 * 60 * 1000,
			url: "https://ci.example.internal/job/northwind-integration-tests/4126/",
			stages: [
				{ id: "deploy", name: "Deploy", status: "success" },
				{ id: "unit-tests", name: "Unit Tests", status: "success" },
				{ id: "integration", name: "Integration", status: "success" },
				{ id: "sync-suite", name: "Run sync suite", status: "success" },
				{ id: "reporting", name: "Reporting", status: "success" },
			],
		},
	];
}

// ---------------------------------------------------------------------------
// Tickets -- shape matches ~/Workspace/emcee internal/domain/issue.go
// ---------------------------------------------------------------------------

export type IssueStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "canceled";
export type IssuePriority = "urgent" | "high" | "medium" | "low" | "none";

export interface Issue {
	ref: string;
	key: string;
	title: string;
	status: IssueStatus;
	rawStatus?: string;
	priority: IssuePriority;
	assignee?: string;
	labels: string[];
	project: string;
	updatedAt: string;
}

export function mockIssues(): Issue[] {
	return [
		{
			ref: "tracker:SYNC-4821",
			key: "SYNC-4821",
			title: "Failover pin gets stuck mid-handoff",
			status: "in_progress",
			rawStatus: "ON_QA",
			priority: "urgent",
			assignee: "j.rivera",
			labels: ["blocker", "failover"],
			project: "Northwind / sync",
			updatedAt: "2026-07-21T08:40:00Z",
		},
		{
			ref: "tracker:SYNC-4790",
			key: "SYNC-4790",
			title: "Holdover window regresses under load",
			status: "in_review",
			rawStatus: "MODIFIED",
			priority: "high",
			assignee: "j.rivera",
			labels: ["holdover", "regression"],
			project: "Northwind / sync",
			updatedAt: "2026-07-21T07:55:00Z",
		},
		{
			ref: "tracker:SYNC-4711",
			key: "SYNC-4711",
			title: "Spurious freerun state during recovery",
			status: "todo",
			priority: "high",
			labels: ["freerun"],
			project: "Northwind / sync",
			updatedAt: "2026-07-20T14:02:00Z",
		},
		{
			ref: "tracker:SYNC-4655",
			key: "SYNC-4655",
			title: "Dual-publisher race on relay restart",
			status: "in_progress",
			priority: "high",
			assignee: "j.rivera",
			labels: ["relay", "race-condition"],
			project: "Northwind / sync",
			updatedAt: "2026-07-19T11:20:00Z",
		},
		{
			ref: "tracker:SYNC-4602",
			key: "SYNC-4602",
			title: "New hardware profile initialization issues",
			status: "backlog",
			priority: "high",
			labels: ["hardware-profile"],
			project: "Northwind / sync",
			updatedAt: "2026-07-18T09:10:00Z",
		},
	];
}

// ---------------------------------------------------------------------------
// PRs -- shape matches ~/Workspace/emcee internal/domain/pullrequest.go
// ---------------------------------------------------------------------------

export type PRState = "open" | "merged" | "closed";
export type PRReviewState = "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "PENDING";

export interface PullRequest {
	repo: string;
	number: number;
	title: string;
	author: string;
	state: PRState;
	reviewState: PRReviewState;
	url: string;
	updatedAt: string;
}

export function mockPullRequests(): PullRequest[] {
	return [
		{
			repo: "northwind/sync-daemon",
			number: 608,
			title: "Fix failover pin race (SYNC-4821)",
			author: "j.rivera",
			state: "open",
			reviewState: "CHANGES_REQUESTED",
			url: "https://git.example.internal/northwind/sync-daemon/pull/608",
			updatedAt: "2026-07-21T08:05:00Z",
		},
		{
			repo: "northwind/sync-daemon",
			number: 607,
			title: "Guard holdover timeout injection path (SYNC-4790)",
			author: "j.rivera",
			state: "open",
			reviewState: "APPROVED",
			url: "https://git.example.internal/northwind/sync-daemon/pull/607",
			updatedAt: "2026-07-20T16:30:00Z",
		},
		{
			repo: "northwind/beacon-sync-operator",
			number: 707,
			title: "Bump to platform 5.0",
			author: "j.rivera",
			state: "open",
			reviewState: "COMMENTED",
			url: "https://git.example.internal/northwind/beacon-sync-operator/pull/707",
			updatedAt: "2026-07-19T13:00:00Z",
		},
		{
			repo: "northwind/event-relay",
			number: 703,
			title: "Dual-publisher fix for relay restart race",
			author: "j.rivera",
			state: "merged",
			reviewState: "APPROVED",
			url: "https://git.example.internal/northwind/event-relay/pull/703",
			updatedAt: "2026-07-17T10:15:00Z",
		},
	];
}

// ---------------------------------------------------------------------------
// Terminal -- no external schema, plain command/output log
// ---------------------------------------------------------------------------

export interface TerminalLine {
	kind: "command" | "output" | "error" | "info";
	text: string;
}

export function mockTerminalSession(): TerminalLine[] {
	return [
		{ kind: "command", text: "$ kubectl get pods -n beacon-sync" },
		{ kind: "output", text: "sync-daemon-4xk2p             3/3     Running   0    2d" },
		{ kind: "output", text: "sync-daemon-9jr7q             3/3     Running   0    2d" },
		{ kind: "output", text: "beacon-sync-operator-6f9d8c   1/1     Running   0    9d" },
		{ kind: "command", text: "$ syncctl status --node 0" },
		{ kind: "output", text: "querying current sync state\u2026" },
		{ kind: "output", text: "\tstepsRemoved       0" },
		{ kind: "output", text: "\toffsetFromMaster   -4.0" },
		{ kind: "output", text: "\tmeanPathDelay      682.0" },
		{ kind: "command", text: "$ kubectl logs sync-daemon-4xk2p --tail=5" },
		{ kind: "info", text: "sync-daemon: port 1: state change from LISTENING to SLAVE" },
		{ kind: "error", text: "sync-daemon: rms 42 max 68 freq -3120 +/- 12 delay 682 +/- 4" },
		{ kind: "command", text: "$ agent: correlating SYNC-4790 against last 3 holdover CI runs\u2026" },
		{ kind: "info", text: "agent: found matching failure pattern in northwind-regression-suite#889 and #887" },
	];
}

// ---------------------------------------------------------------------------
// Workflow -- static node/edge diagram, inspired by the visual language of
// ~/Repositories/open-agent-builder (@xyflow/react) but hand-rendered since
// this is a read-only mock, not an editable graph.
// ---------------------------------------------------------------------------

export type WorkflowNodeKind = "start" | "agent" | "tool" | "decision" | "end";

export interface WorkflowNode {
	id: string;
	kind: WorkflowNodeKind;
	label: string;
}

export interface WorkflowEdge {
	from: string;
	to: string;
	label?: string;
}

export interface WorkflowGraph {
	nodes: WorkflowNode[];
	edges: WorkflowEdge[];
}

/** A generic QE/SRE recurring investigation loop -- not tied to any real product or org. */
export function mockWorkflow(): WorkflowGraph {
	return {
		nodes: [
			{ id: "detect", kind: "start", label: "Detect failure" },
			{ id: "collect", kind: "tool", label: "Collect evidence\n(CI / dashboards / archive)" },
			{ id: "correlate", kind: "agent", label: "Correlate with tickets\n+ prior cases" },
			{ id: "inspect", kind: "agent", label: "Inspect source\n+ commit lineage" },
			{ id: "decide", kind: "decision", label: "Decide path" },
			{ id: "execute", kind: "tool", label: "Execute lab / CI\nintervention" },
			{ id: "validate", kind: "tool", label: "Validate on\nstaging / CI" },
			{ id: "archive", kind: "end", label: "Update status\n+ archive" },
		],
		edges: [
			{ from: "detect", to: "collect" },
			{ from: "collect", to: "correlate" },
			{ from: "correlate", to: "inspect" },
			{ from: "inspect", to: "decide" },
			{ from: "decide", to: "execute", label: "deploy / code / test" },
			{ from: "execute", to: "validate" },
			{ from: "validate", to: "archive" },
			{ from: "archive", to: "detect", label: "repeat" },
		],
	};
}
