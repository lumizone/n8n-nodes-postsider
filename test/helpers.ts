import { NodeHelpers, type INode, type INodeProperties } from 'n8n-workflow';

import { PostSider } from '../nodes/PostSider/PostSider.node.ts';
import { PostSiderTrigger } from '../nodes/PostSiderTrigger/PostSiderTrigger.node.ts';

export const testNode: INode = {
	id: 'test-node',
	name: 'PostSider',
	type: 'n8n-nodes-postsider.postSider',
	typeVersion: 2.1,
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
	itemCount?: number;
	/** Time zone of the workflow, read by getTimezone(). */
	timezone?: string;
	/**
	 * Pass the parameters through n8n's own display rules for `typeVersion`, like a saved workflow: n8n
	 * drops every parameter whose property is not displayed. On by default when `params.resource` is set;
	 * `false` hands the params to the executor as they are.
	 */
	model?: boolean;
	/** Which node's description to model: the PostSider node or the trigger. */
	nodeKind?: 'postSider' | 'trigger';
	/** Binary data of the first item: property name to IBinaryData (the id marks filesystem mode). */
	binary?: Record<string, Record<string, unknown>>;
	/** Called for getBinaryMetadata(id) and getBinaryDataBuffer. */
	binaryBuffers?: Record<string, Buffer>;
}

const descriptions = {
	postSider: new PostSider().description,
	trigger: new PostSiderTrigger().description,
};

/**
 * What n8n makes of saved parameters for a node version: drop every parameter that is not displayed
 * (`getNodeParameters` with returnDefaults off, as when a workflow is saved), then fill the defaults of the
 * displayed ones (as when the node runs). Returns the parameters the executor can read.
 */
export function modelNodeParameters(
	params: Record<string, unknown>,
	typeVersion: number,
	kind: 'postSider' | 'trigger' = 'postSider',
): Record<string, unknown> {
	const description = descriptions[kind];
	const node = { ...testNode, typeVersion };
	const properties = description.properties as INodeProperties[];
	const saved = NodeHelpers.getNodeParameters(properties, params as never, false, false, node, description);
	const loaded = NodeHelpers.getNodeParameters(properties, (saved ?? {}) as never, true, false, node, description);
	return (loaded ?? {}) as Record<string, unknown>;
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
		typeVersion: options.typeVersion ?? 2.1,
	};
	const modelled =
		options.model ?? 'resource' in params
			? modelNodeParameters(params, node.typeVersion, options.nodeKind)
			: params;
	const context = {
		getInputData: () => Array.from({ length: options.itemCount ?? 1 }, () => ({ json: {} })),
		getNodeParameter: (...args: unknown[]) => {
			const [name, , fallback] = args as [string, number, unknown];
			const value = modelled[name];
			// n8n throws for a parameter that is not set and has no fallback.
			if (value === undefined && args.length < 3) {
				throw new Error(`Could not get parameter '${name}'`);
			}
			return value ?? fallback;
		},
		getTimezone: () => options.timezone ?? 'UTC',
		getExecutionId: () => options.executionId ?? 'ex1',
		getWorkflow: () => ({ id: options.workflowId ?? 'wf1', active: false }),
		getInstanceId: () => options.instanceId ?? 'inst1',
		getCredentials: async () => ({ apiKey: 'k', baseUrl: 'https://api.postsider.com' }),
		continueOnFail: () => Boolean(options.continueOnFail),
		getNode: () => node,
		getWorkflowDataProxy: () => ({ $runIndex: options.runIndex ?? 0 }),
		helpers: {
			assertBinaryData: (_i: number, name: string) => {
				const meta = options.binary?.[name];
				if (!meta) throw new Error(`no binary '${name}'`);
				return meta;
			},
			getBinaryMetadata: async (id: string) => ({ fileSize: options.binaryBuffers?.[id]?.length ?? 0 }),
			getBinaryDataBuffer: async (_i: number, name: string) => {
				const meta = options.binary?.[name] as { id?: string; data?: string } | undefined;
				if (meta?.id && options.binaryBuffers?.[meta.id]) return options.binaryBuffers[meta.id];
				return Buffer.from(meta?.data ?? '', 'base64');
			},
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
