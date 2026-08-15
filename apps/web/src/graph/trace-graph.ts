interface EdgeRecord {
	readonly source: string;
	readonly target: string;
	readonly attributes: Record<string, unknown>;
}

/**
 * A minimal directed graph -- exactly the operations session-graph.ts and
 * projector.ts actually use (node/edge existence, node/edge attributes,
 * in/out neighbors in insertion order, filtering by attribute, node/edge
 * counts). Replaces graphology, previously pulled in for this narrow a
 * surface (confirmed via a real bundle-visualizer trace, not assumed -- see
 * the linked Papyrus Doc and the "Diagnose and fix wasteful JS/TS bundle
 * size" Playbook). Not a general-purpose graph library: no traversal
 * algorithms, no removal, no undirected edges -- reach for a real graph
 * library if a future consumer genuinely needs one of those, rather than
 * growing this ad hoc.
 */
export class TraceGraph {
	private readonly nodeAttrs = new Map<string, Record<string, unknown>>();
	private readonly outEdges = new Map<string, Map<string, string>>(); // source -> target -> edge id
	private readonly inSources = new Map<string, Set<string>>(); // target -> sources
	private readonly edgeRecords = new Map<string, EdgeRecord>(); // edge id -> record
	private nextEdgeId = 0;

	get order(): number {
		return this.nodeAttrs.size;
	}

	get size(): number {
		return this.edgeRecords.size;
	}

	hasNode(id: string): boolean {
		return this.nodeAttrs.has(id);
	}

	addNode(id: string, attributes: Record<string, unknown>): void {
		this.nodeAttrs.set(id, attributes);
	}

	getNodeAttribute(id: string, key: string): unknown {
		return this.nodeAttrs.get(id)?.[key];
	}

	hasDirectedEdge(source: string, target: string): boolean {
		return this.outEdges.get(source)?.has(target) ?? false;
	}

	addDirectedEdge(source: string, target: string, attributes: Record<string, unknown>): void {
		if (this.hasDirectedEdge(source, target)) return;
		const id = `e${this.nextEdgeId++}`;
		let targets = this.outEdges.get(source);
		if (!targets) {
			targets = new Map();
			this.outEdges.set(source, targets);
		}
		targets.set(target, id);
		let sources = this.inSources.get(target);
		if (!sources) {
			sources = new Set();
			this.inSources.set(target, sources);
		}
		sources.add(source);
		this.edgeRecords.set(id, { source, target, attributes });
	}

	/** Target ids of source's outgoing edges, in the order those edges were first added. */
	outNeighbors(source: string): string[] {
		return Array.from(this.outEdges.get(source)?.keys() ?? []);
	}

	/** Source ids of every edge pointing at target. */
	inNeighbors(target: string): string[] {
		return Array.from(this.inSources.get(target) ?? []);
	}

	filterNodes(predicate: (id: string, attributes: Record<string, unknown>) => boolean): string[] {
		const result: string[] = [];
		for (const [id, attrs] of this.nodeAttrs) {
			if (predicate(id, attrs)) result.push(id);
		}
		return result;
	}

	/** Every edge's own opaque id, in insertion order -- resolve with source/target/getEdgeAttribute. */
	edges(): string[] {
		return Array.from(this.edgeRecords.keys());
	}

	getEdgeAttribute(edgeId: string, key: string): unknown {
		return this.edgeRecords.get(edgeId)?.attributes[key];
	}

	source(edgeId: string): string {
		const record = this.edgeRecords.get(edgeId);
		if (!record) throw new Error(`TraceGraph: unknown edge "${edgeId}"`);
		return record.source;
	}

	target(edgeId: string): string {
		const record = this.edgeRecords.get(edgeId);
		if (!record) throw new Error(`TraceGraph: unknown edge "${edgeId}"`);
		return record.target;
	}
}
