import {
	ContributionDescriptionSchema,
	ContributionResourceReferenceSchema,
	type ContributionDescription,
	type ContributionOutcome,
	type ContributionReadBounds,
	type ContributionResourceReference,
} from "@zodiac/protocol";

export interface ContributionClient {
	list: () => Promise<readonly ContributionDescription[]>;
	invoke: (contributionId: string, commandId: string, input?: unknown) => Promise<ContributionOutcome<ContributionResourceReference>>;
	read: (contributionId: string, resource: ContributionResourceReference, bounds: ContributionReadBounds) => Promise<ContributionOutcome<unknown>>;
}

function outcome(value: unknown): ContributionOutcome<unknown> {
	if (typeof value !== "object" || value === null || !("ok" in value)) throw new Error("Invalid contribution outcome from zodiacd");
	const candidate = value as { ok: unknown; value?: unknown; code?: unknown; message?: unknown };
	if (candidate.ok === true) return { ok: true, value: candidate.value };
	if (candidate.ok === false && typeof candidate.code === "string" && typeof candidate.message === "string") return { ok: false, code: candidate.code, message: candidate.message };
	throw new Error("Invalid contribution outcome from zodiacd");
}

export function createHttpContributionClient(baseUrl: string, fetcher: typeof fetch = globalThis.fetch): ContributionClient {
	const post = async (url: string, payload: unknown): Promise<unknown> => {
		const response = await fetcher(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
		if (!response.ok) throw new Error(`Contribution request failed (${response.status})`);
		return response.json();
	};
	return {
		async list() {
			const response = await fetcher(`${baseUrl}/api/contributions`);
			if (!response.ok) throw new Error(`Contribution catalog request failed (${response.status})`);
			const raw = await response.json() as { contributions?: unknown };
			const parsed = ContributionDescriptionSchema.array().safeParse(raw.contributions);
			if (!parsed.success) throw new Error("Invalid contribution catalog from zodiacd");
			return parsed.data;
		},
		async invoke(contributionId, commandId, input) {
			const raw = outcome(await post(`${baseUrl}/api/contributions/${encodeURIComponent(contributionId)}/invoke`, { commandId, input }));
			if (!raw.ok) return raw;
			const parsed = ContributionResourceReferenceSchema.safeParse(raw.value);
			if (!parsed.success) throw new Error("Contribution command returned an invalid resource reference");
			return { ok: true, value: parsed.data };
		},
		async read(contributionId, resource, bounds) {
			return outcome(await post(`${baseUrl}/api/contributions/${encodeURIComponent(contributionId)}/read`, { resource, bounds }));
		},
	};
}
