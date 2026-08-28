import { EditorOpenClientActionSchema, WorkspaceIdSchema, type EditorOpenClientAction } from "@zodiac/protocol";
import { z } from "zod";

const MAX_EVIDENCE_SUMMARY_BYTES = 2_000;
const NavigationToolOutputSchema = z
	.object({
		content: z.array(z.object({ type: z.literal("text"), text: z.string().max(MAX_EVIDENCE_SUMMARY_BYTES) }).strict()).max(4),
		details: z
			.object({
				evidence: z
					.object({
						summary: z.string().max(MAX_EVIDENCE_SUMMARY_BYTES),
						provenance: z.object({ operation: z.string().min(1).max(200), symbol: z.string().min(1).max(500).optional() }).strict().optional(),
					})
					.strict(),
				clientActions: z.array(EditorOpenClientActionSchema).length(1),
			})
			.strict(),
	})
	.strict();

const GroundedEditorNavigationEvidenceSchema = z
	.object({
		workspaceId: WorkspaceIdSchema,
		result: z
			.object({
				ok: z.literal(true),
				value: z
					.object({
						summary: z.string().min(1).max(MAX_EVIDENCE_SUMMARY_BYTES),
						resource: z.object({ path: EditorOpenClientActionSchema.shape.resource.shape.path, contentHash: EditorOpenClientActionSchema.shape.resource.shape.contentHash }).strict(),
						position: EditorOpenClientActionSchema.shape.position,
						provenance: z.object({ operation: z.string().min(1).max(200), symbol: z.string().min(1).max(500).optional() }).strict().optional(),
					})
					.strict(),
			})
			.strict(),
	})
	.strict();

export type GroundedEditorNavigationEvidence = z.input<typeof GroundedEditorNavigationEvidenceSchema>;

/** Produces bounded model-visible evidence and one developer-defined client action from a grounded Lector result. */
export function createAgentNavigationResult(input: GroundedEditorNavigationEvidence) {
	const evidence = GroundedEditorNavigationEvidenceSchema.parse(input);
	const { summary, resource, position, provenance } = evidence.result.value;
	const action = EditorOpenClientActionSchema.parse({ version: 1, type: "editor.open", workspaceId: evidence.workspaceId, resource: { integrationId: "lector", ...resource }, position });
	return NavigationToolOutputSchema.parse({
		content: [{ type: "text", text: summary }],
		details: {
			evidence: { summary, ...(provenance ? { provenance } : {}) },
			clientActions: [action],
		},
	});
}

/** Extracts only a fully schema-valid editor action; prose and arbitrary tool details produce no action. */
export function extractAgentNavigationAction(output: unknown): EditorOpenClientAction | undefined {
	const parsed = NavigationToolOutputSchema.safeParse(output);
	return parsed.success ? parsed.data.details.clientActions[0] : undefined;
}
