import {
	ContributionCardinalitySchema,
	ContributionProvenanceSchema,
	type ContributionPointDefinition,
	type ContributionProvenance,
} from "@zodiac/protocol";

export type ContributionPointMap = { [kind: string]: { readonly id: string } };

export interface RegisteredContribution<TValue> {
	readonly value: TValue;
	readonly provenance: ContributionProvenance;
}

export class ContributionCardinalityError extends Error {
	readonly point: string;
	readonly expected: string;
	readonly actual: number;

	constructor(point: string, expected: string, actual: number) {
		super(`Contribution point "${point}" requires ${expected}; received ${actual}`);
		this.name = "ContributionCardinalityError";
		this.point = point;
		this.expected = expected;
		this.actual = actual;
	}
}

export interface ContributionPointRegistry<TPoints extends { [K in keyof TPoints]: { readonly id: string } }> {
	register<K extends keyof TPoints & string>(kind: K, value: TPoints[K], provenance: ContributionProvenance): () => void;
	entries<K extends keyof TPoints & string>(kind: K): readonly RegisteredContribution<TPoints[K]>[];
	validate(): void;
}

/**
 * Stores host-owned contribution values under named points while enforcing the
 * point's declared cardinality independently of the value shape. Registration
 * returns an idempotent lifecycle handle so activation strategies can roll
 * back partial startup and remove disposed contributions without stale state.
 */
export function createContributionPointRegistry<TPoints extends { [K in keyof TPoints]: { readonly id: string } }>(
	definitions: readonly ContributionPointDefinition<keyof TPoints & string>[],
): ContributionPointRegistry<TPoints> {
	const cardinality = new Map<keyof TPoints & string, ContributionPointDefinition["cardinality"]>();
	const values = new Map<keyof TPoints & string, RegisteredContribution<TPoints[keyof TPoints & string]>[]>();

	for (const definition of definitions) {
		if (cardinality.has(definition.kind)) throw new Error(`Duplicate contribution point definition: ${definition.kind}`);
		cardinality.set(definition.kind, ContributionCardinalitySchema.parse(definition.cardinality));
		values.set(definition.kind, []);
	}

	function recordsFor<K extends keyof TPoints & string>(kind: K): RegisteredContribution<TPoints[K]>[] {
		const records = values.get(kind);
		if (!records || !cardinality.has(kind)) throw new Error(`Unknown contribution point: ${kind}`);
		return records as RegisteredContribution<TPoints[K]>[];
	}

	return {
		register(kind, value, provenance) {
			const records = recordsFor(kind);
			if (records.some((entry) => entry.value.id === value.id)) throw new Error(`Duplicate ${kind} contribution id: ${value.id}`);
			const expected = cardinality.get(kind);
			if ((expected === "exactly-one" || expected === "zero-or-one") && records.length >= 1) {
				throw new ContributionCardinalityError(kind, expected, records.length + 1);
			}
			const entry: RegisteredContribution<TPoints[typeof kind]> = {
				value,
				provenance: Object.freeze(ContributionProvenanceSchema.parse(provenance)),
			};
			records.push(entry);
			let registered = true;
			return () => {
				if (!registered) return;
				registered = false;
				const index = records.indexOf(entry);
				if (index >= 0) records.splice(index, 1);
			};
		},
		entries: (kind) => [...recordsFor(kind)],
		validate() {
			for (const [kind, expected] of cardinality) {
				const actual = values.get(kind)?.length ?? 0;
				if (expected === "exactly-one" && actual !== 1) throw new ContributionCardinalityError(kind, expected, actual);
				if (expected === "zero-or-one" && actual > 1) throw new ContributionCardinalityError(kind, expected, actual);
			}
		},
	};
}
