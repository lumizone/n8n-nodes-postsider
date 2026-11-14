import type { INode } from 'n8n-workflow';

export const testNode: INode = {
	id: 'test-node',
	name: 'PostSider',
	type: 'n8n-nodes-postsider.postSider',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

export interface FakeContextOptions {
	executionId?: string;
	workflowId?: string;
	instanceId?: string;
	nodeName?: string;
	typeVersion?: number;
	runIndex?: number;
	continueOnFail?: boolean;
}

/**
 * An execute context with just enough surface for the PostSider executors. `responses` are returned (or
 * thrown when an Error) in order, one for each HTTP request; every request is recorded in `requests`.
 */
export function makeFakeContext(
	params: Record<string, unknown>,
	responses: unknown[],
	options: FakeContextOptions = {},
) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const requests: Array<Record<string, any>> = [];
	const node = {
		...testNode,
		name: options.nodeName ?? testNode.name,
		typeVersion: options.typeVersion ?? 2,
	};
	const context = {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name: string, _i: number, fallback?: unknown) => params[name] ?? fallback,
		getExecutionId: () => options.executionId ?? 'ex1',
		getWorkflow: () => ({ id: options.workflowId ?? 'wf1', active: false }),
		getInstanceId: () => options.instanceId ?? 'inst1',
		getCredentials: async () => ({ apiKey: 'k', baseUrl: 'https://api.postsider.com' }),
		continueOnFail: () => Boolean(options.continueOnFail),
		getNode: () => node,
		getWorkflowDataProxy: () => ({ $runIndex: options.runIndex ?? 0 }),
		helpers: {
			httpRequestWithAuthentication: async (_c: string, request: Record<string, unknown>) => {
				requests.push(request);
				const next = responses.shift();
				if (next instanceof Error) throw next;
				return next;
			},
			returnJsonArray: (d: unknown) =>
				(Array.isArray(d) ? d : [d]).map((json: unknown) => ({ json })),
			constructExecutionMetaData: (d: unknown[], m: { itemData: unknown }) =>
				d.map((e) => ({ ...(e as object), pairedItem: m.itemData })),
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
	return { context, requests };
}
