/**
 * Synthetic but realistic mock data for the tiling primitives playground.
 *
 * "Realistic" means: field names and enums are copied from the real Go
 * domain types at ~/Workspace/conty (CI) and ~/Workspace/emcee (tickets,
 * PRs), and content is flavored with real PTP/OCPBUGS domain detail from
 * the ptp-sdlc-source-of-truth-map-386e Scribe note (real OCPBUGS numbers,
 * real repo names, real CI job/stage names) -- none of it is live data,
 * and none of these values should be mistaken for actual current state.
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
			id: "ocp-far-edge-vran-tests-4127",
			name: "ocp-far-edge-vran-tests",
			status: "running",
			startedAt: "2026-07-21T09:12:00Z",
			durationMs: 41 * 60 * 1000,
			url: "https://jenkins-ci.corp.redhat.com/job/ocp-far-edge-vran-tests/4127/",
			stages: [
				{ id: "deploy", name: "Deploy", status: "success", durationMs: 8 * 60 * 1000 },
				{ id: "system-tests", name: "System Tests", status: "success", durationMs: 6 * 60 * 1000 },
				{ id: "eco-gotests", name: "eco-gotests", status: "success", durationMs: 4 * 60 * 1000 },
				{
					id: "vran-tests",
					name: "Run ptp test",
					status: "running",
					durationMs: 23 * 60 * 1000,
					steps: [
						{ id: "t-bc-holdover", name: "T-BC holdover", status: "success", durationMs: 6 * 60 * 1000 },
						{ id: "t-tsc", name: "T-TSC", status: "success", durationMs: 5 * 60 * 1000 },
						{ id: "oc-2-port", name: "OC 2-Port", status: "running" },
						{ id: "gnss-loss", name: "GNSS loss", status: "pending" },
					],
				},
				{ id: "reporting", name: "Reporting", status: "pending" },
			],
		},
		{
			id: "ocp-eco-gotests-891",
			name: "ocp-eco-gotests",
			status: "failure",
			startedAt: "2026-07-21T06:00:00Z",
			durationMs: 5 * 3600 * 1000 + 18 * 60 * 1000,
			url: "https://jenkins-ci.corp.redhat.com/job/ocp-eco-gotests/891/",
			stages: [
				{ id: "ptp-3wpc", name: "PTP 3 WPC Validation", status: "failure", durationMs: 12 * 60 * 1000 },
				{ id: "stability", name: "StabilityNoWorkload", status: "aborted" },
			],
		},
		{
			id: "ocp-far-edge-vran-tests-4126",
			name: "ocp-far-edge-vran-tests",
			status: "success",
			startedAt: "2026-07-20T00:03:00Z",
			durationMs: 58 * 60 * 1000,
			url: "https://jenkins-ci.corp.redhat.com/job/ocp-far-edge-vran-tests/4126/",
			stages: [
				{ id: "deploy", name: "Deploy", status: "success" },
				{ id: "system-tests", name: "System Tests", status: "success" },
				{ id: "eco-gotests", name: "eco-gotests", status: "success" },
				{ id: "vran-tests", name: "Run ptp test", status: "success" },
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
			ref: "jira:OCPBUGS-86565",
			key: "OCPBUGS-86565",
			title: "DPLL pin operational state cluster",
			status: "in_progress",
			rawStatus: "ON_QA",
			priority: "urgent",
			assignee: "dpopsuev",
			labels: ["blocker", "dpll"],
			project: "Networking / ptp",
			updatedAt: "2026-07-21T08:40:00Z",
		},
		{
			ref: "jira:OCPBUGS-90712",
			key: "OCPBUGS-90712",
			title: "HOLDOVER regression 528ms vs 360s",
			status: "in_review",
			rawStatus: "MODIFIED",
			priority: "high",
			assignee: "dpopsuev",
			labels: ["holdover", "regression"],
			project: "Networking / ptp",
			updatedAt: "2026-07-21T07:55:00Z",
		},
		{
			ref: "jira:OCPBUGS-90101",
			key: "OCPBUGS-90101",
			title: "Spurious FREERUN during recovery",
			status: "todo",
			priority: "high",
			labels: ["freerun"],
			project: "Networking / ptp",
			updatedAt: "2026-07-20T14:02:00Z",
		},
		{
			ref: "jira:OCPBUGS-88708",
			key: "OCPBUGS-88708",
			title: "T-BC CLOCK_REALTIME dual-publisher",
			status: "in_progress",
			priority: "high",
			assignee: "dpopsuev",
			labels: ["t-bc", "cloud-event"],
			project: "Networking / ptp",
			updatedAt: "2026-07-19T11:20:00Z",
		},
		{
			ref: "jira:OCPBUGS-88741",
			key: "OCPBUGS-88741",
			title: "GNR-D initialization issues",
			status: "backlog",
			priority: "high",
			labels: ["gnr-d"],
			project: "Networking / ptp",
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
			repo: "openshift/linuxptp-daemon",
			number: 608,
			title: "Fix DPLL pin state race (OCPBUGS-87869)",
			author: "dpopsuev",
			state: "open",
			reviewState: "CHANGES_REQUESTED",
			url: "https://github.com/openshift/linuxptp-daemon/pull/608",
			updatedAt: "2026-07-21T08:05:00Z",
		},
		{
			repo: "openshift/linuxptp-daemon",
			number: 607,
			title: "Guard holdover timeout injection path (OCPBUGS-87868)",
			author: "dpopsuev",
			state: "open",
			reviewState: "APPROVED",
			url: "https://github.com/openshift/linuxptp-daemon/pull/607",
			updatedAt: "2026-07-20T16:30:00Z",
		},
		{
			repo: "openshift/ptp-operator",
			number: 707,
			title: "Bump to 5.0",
			author: "dpopsuev",
			state: "open",
			reviewState: "COMMENTED",
			url: "https://github.com/openshift/ptp-operator/pull/707",
			updatedAt: "2026-07-19T13:00:00Z",
		},
		{
			repo: "redhat-cne/cloud-event-proxy",
			number: 703,
			title: "Dual-publisher fix for T-BC CLOCK_REALTIME",
			author: "dpopsuev",
			state: "merged",
			reviewState: "APPROVED",
			url: "https://github.com/redhat-cne/cloud-event-proxy/pull/703",
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
		{ kind: "command", text: "$ oc get pods -n openshift-ptp" },
		{ kind: "output", text: "linuxptp-daemon-4xk2p          3/3     Running   0    2d" },
		{ kind: "output", text: "linuxptp-daemon-9jr7q          3/3     Running   0    2d" },
		{ kind: "output", text: "ptp-operator-6f9d8c7b4-wq2xz   1/1     Running   0    9d" },
		{ kind: "command", text: "$ pmc -u -b 0 'GET CURRENT_DATA_SET'" },
		{ kind: "output", text: "sending: GET CURRENT_DATA_SET" },
		{ kind: "output", text: "\tstepsRemoved       0" },
		{ kind: "output", text: "\toffsetFromMaster   -4.0" },
		{ kind: "output", text: "\tmeanPathDelay      682.0" },
		{ kind: "command", text: "$ oc logs linuxptp-daemon-4xk2p -c linuxptp-daemon-container --tail=5" },
		{ kind: "info", text: "ptp4l[812043.129]: port 1: state change from LISTENING to SLAVE" },
		{ kind: "error", text: "ptp4l[812043.512]: rms 42 max 68 freq -3120 +/- 12 delay 682 +/- 4" },
		{ kind: "command", text: "$ agent: correlating OCPBUGS-90712 against last 3 holdover CI runs\u2026" },
		{ kind: "info", text: "agent: found matching failure pattern in ocp-eco-gotests#889 and #887" },
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

/** The QE "recurring operating loop" from the ptp-qe-workflow Scribe note. */
export function mockWorkflow(): WorkflowGraph {
	return {
		nodes: [
			{ id: "detect", kind: "start", label: "Detect failure" },
			{ id: "collect", kind: "tool", label: "Collect evidence\n(RP / Jenkins / archive)" },
			{ id: "correlate", kind: "agent", label: "Correlate with Jira\n+ prior cases" },
			{ id: "inspect", kind: "agent", label: "Inspect source\n+ commit lineage" },
			{ id: "decide", kind: "decision", label: "Decide path" },
			{ id: "execute", kind: "tool", label: "Execute lab / CI\nintervention" },
			{ id: "validate", kind: "tool", label: "Validate on\nspoke / CI" },
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
