/**
 * A minimal, deliberately loose ambient shim for the two Bun-only symbols reachable through
 * @danypops/lector's and @danypops/vehicle-server's own public TypeScript source (their "types"
 * field points straight at raw .ts source, so consuming their public operation-contract types
 * -- OperationInputs/OperationOutputs -- pulls their sqlite-backed adapters' own type surface
 * into this program too, even though this app never imports or runs that code path). The real
 * `bun-types` package would work too, but its own ambient globals (fetch/WebSocket/...)
 * conflict with @types/node's; this app runs under Node, never Bun, so only these two symbols
 * -- resolved as opaque `unknown`, never actually constructed here -- need to type-check at all.
 */
declare module "bun:sqlite" {
	export class Database {
		constructor(...args: unknown[]);
		// biome-ignore lint/suspicious/noExplicitAny: opaque by design -- see this file's own doc comment.
		[member: string]: any;
	}
	export type DatabaseOptions = Record<string, unknown>;
}

declare const Bun: unknown;

/**
 * @danypops/lector's own lsp-symbol-index.ts and service/workspace-watch-handlers.ts import
 * picomatch directly; @types/picomatch is installed at this workspace's own root, but
 * TypeScript's "bundler" module resolution does not always walk up into a sibling package's
 * own ancestor node_modules/@types for an implicit (non-"types"-field) package the way plain
 * Node resolution does. A precise, minimal shim -- not `any` -- keeps picomatch's own call
 * shape intact for anything in this app that imports it directly.
 */
declare module "picomatch" {
	type PicomatchOptions = Record<string, unknown>;
	function picomatch(pattern: string | readonly string[], options?: PicomatchOptions): (input: string) => boolean;
	export = picomatch;
}
