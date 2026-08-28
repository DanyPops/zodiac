import { z } from "zod";
import { WorkspaceIdSchema } from "./ids.js";

export const MAX_CLIENT_ACTION_PATH_BYTES = 1_024;
export const MAX_CLIENT_ACTION_HASH_BYTES = 256;
export const MAX_CLIENT_ACTION_POSITION = 10_000_000;

const WorkspaceRelativePathSchema = z
	.string()
	.min(1)
	.max(MAX_CLIENT_ACTION_PATH_BYTES)
	.refine((value) => !value.startsWith("/") && !value.startsWith("\\") && !value.includes("\\") && !value.split("/").includes(".."), "path must stay relative to its Workspace");

export const EditorOpenClientActionSchema = z
	.object({
		version: z.literal(1),
		type: z.literal("editor.open"),
		workspaceId: WorkspaceIdSchema,
		resource: z
			.object({
				integrationId: z.literal("lector"),
				path: WorkspaceRelativePathSchema,
				contentHash: z.string().min(1).max(MAX_CLIENT_ACTION_HASH_BYTES),
			})
			.strict(),
		position: z
			.object({
				line: z.number().int().nonnegative().max(MAX_CLIENT_ACTION_POSITION),
				character: z.number().int().nonnegative().max(MAX_CLIENT_ACTION_POSITION),
			})
			.strict(),
	})
	.strict();

export type EditorOpenClientAction = z.infer<typeof EditorOpenClientActionSchema>;
