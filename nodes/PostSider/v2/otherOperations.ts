import type { IDataObject, IExecuteFunctions, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { readControlParameters, runControlRequest } from '../shared/approvals';
import {
	buildOperationRequest,
	extractList,
	normalizePostResponse,
	type OperationRequest,
} from '../shared/operations';
import { postSiderApiRequest } from '../shared/transport';
import { parseIdList, parseUrlList } from './inputs';
import { uploadBinaries, uploadFromUrls, type ApiCall } from './media';

const DEFAULT_ANALYTICS_DAYS = 7;
const CONTROL_RESOURCES = new Set(['approval', 'policy', 'group']);
const MEDIA_LIST_KEYS = ['results', 'media', 'items', 'data'];

function has(value: unknown): boolean {
	return value !== undefined && value !== null;
}

function required(node: INode, params: IDataObject, name: string, displayName: string): string {
	const value = String(params[name] ?? '').trim();
	if (!value) throw new NodeOperationError(node, `${displayName} is required`);
	return value;
}

function encodedId(node: INode, params: IDataObject, name: string, displayName: string): string {
	return encodeURIComponent(required(node, params, name, displayName));
}

function days(node: INode, params: IDataObject): number {
	const value = has(params.days) && params.days !== '' ? Number(params.days) : DEFAULT_ANALYTICS_DAYS;
	if (!Number.isFinite(value) || value < 1) {
		throw new NodeOperationError(node, 'Days must be at least 1');
	}
	return Math.floor(value);
}

function buildMediaRequest(node: INode, operation: string, params: IDataObject): OperationRequest {
	if (operation === 'getMany') {
		const page = has(params.page) && params.page !== '' ? Number(params.page) : 1;
		if (!Number.isInteger(page) || page < 1) {
			throw new NodeOperationError(node, 'Page must be a whole number of 1 or more');
		}
		const search = String(params.search ?? '').trim();
		return { method: 'GET', endpoint: '/media', input: { qs: { page, ...(search ? { search } : {}) } } };
	}
	if (operation === 'delete') {
		return {
			method: 'DELETE',
			endpoint: `/media/${encodedId(node, params, 'mediaId', 'Media ID')}`,
			input: {},
		};
	}
	throw new NodeOperationError(node, `Unsupported PostSider operation: media.${operation}`);
}

function buildChannelRequest(node: INode, operation: string, params: IDataObject): OperationRequest {
	switch (operation) {
		case 'getMany': {
			const groupId = String(params.groupId ?? '').trim();
			return { method: 'GET', endpoint: '/integrations', input: groupId ? { qs: { group: groupId } } : {} };
		}
		case 'getRules':
			return {
				method: 'GET',
				endpoint: `/integration-settings/${encodedId(node, params, 'channelId', 'Channel')}`,
				input: {},
			};
		case 'getOptions': {
			const methodName = String(params.tool ?? '').trim();
			if (!methodName) throw new NodeOperationError(node, 'Option List Name or ID is required');
			const entries = (((params.toolData as IDataObject | undefined)?.field ?? []) as Array<{
				key?: unknown;
				value?: unknown;
			}>).filter((entry) => String(entry?.key ?? '').trim() !== '');
			const data: IDataObject = {};
			for (const entry of entries) data[String(entry.key).trim()] = String(entry.value ?? '');
			return {
				method: 'POST',
				endpoint: `/integration-trigger/${encodedId(node, params, 'channelId', 'Channel')}`,
				input: { body: { methodName, data } },
			};
		}
		case 'findNextSlot':
			return {
				method: 'GET',
				endpoint: `/find-slot/${encodedId(node, params, 'channelId', 'Channel')}`,
				input: {},
			};
		case 'getAnalytics':
			return {
				method: 'GET',
				endpoint: `/analytics/${encodedId(node, params, 'channelId', 'Channel')}`,
				input: { qs: { date: days(node, params) } },
			};
		case 'enable':
		case 'disable':
			return {
				method: 'POST',
				endpoint: `/integrations/${encodedId(node, params, 'channelId', 'Channel')}/${operation}`,
				input: {},
			};
		default:
			throw new NodeOperationError(node, `Unsupported PostSider operation: channel.${operation}`);
	}
}

function buildPublishingRequest(node: INode, operation: string, params: IDataObject): OperationRequest {
	if (operation === 'getState') return { method: 'GET', endpoint: '/publishing/state', input: {} };
	if (operation === 'pause') {
		const reason = String(params.reason ?? '').trim();
		return { method: 'POST', endpoint: '/publishing/pause', input: { body: reason ? { reason } : {} } };
	}
	throw new NodeOperationError(node, `Unsupported PostSider operation: publishing.${operation}`);
}

/** Media list, delete, channel tools and publishing state; approval, policy and group reuse the v1 builder. */
export function buildOtherRequest(
	node: INode,
	resource: string,
	operation: string,
	params: IDataObject,
	executionId: string,
	itemIndex: number,
): OperationRequest {
	if (resource === 'media') return buildMediaRequest(node, operation, params);
	if (resource === 'channel') return buildChannelRequest(node, operation, params);
	if (resource === 'publishing') return buildPublishingRequest(node, operation, params);
	if (CONTROL_RESOURCES.has(resource)) {
		return buildOperationRequest(node, resource, operation, params, executionId, itemIndex);
	}
	throw new NodeOperationError(node, `Unsupported PostSider operation: ${resource}.${operation}`);
}

function asObject(value: unknown): IDataObject {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return { value: value === null || value === undefined ? '' : String(value) };
	}
	return value as IDataObject;
}

export function shapeOtherOutput(
	resource: string,
	operation: string,
	response: unknown,
	params: IDataObject,
): IDataObject[] {
	if (resource === 'media' && operation === 'delete') {
		return [{ id: String(params.mediaId ?? ''), deleted: true }];
	}
	if (resource === 'channel' && operation === 'getOptions') {
		// integration-trigger answers `{ output: <tool result> }`.
		const wrapped = response as { output?: unknown } | null | undefined;
		const result =
			wrapped && typeof wrapped === 'object' && !Array.isArray(wrapped) && 'output' in wrapped
				? wrapped.output
				: response;
		return Array.isArray(result) ? result.map(asObject) : [asObject(result)];
	}
	const normalized = normalizePostResponse(response);
	if (resource === 'media' && operation === 'getMany') {
		if (Array.isArray(normalized)) return normalized.map(asObject);
		const record = (normalized ?? {}) as Record<string, unknown>;
		for (const key of MEDIA_LIST_KEYS) {
			if (Array.isArray(record[key])) return (record[key] as unknown[]).map(asObject);
		}
		return [asObject(normalized)];
	}
	if (resource === 'channel' && operation === 'getMany' && Array.isArray(normalized)) {
		const keep = params.includeDisabled
			? normalized
			: normalized.filter((channel) => !(channel as { disabled?: unknown } | null)?.disabled);
		return keep.map(asObject);
	}
	if (resource === 'policy' && operation === 'getMany') return extractList(normalized).map(asObject);
	if (Array.isArray(normalized)) return normalized.map(asObject);
	return [asObject(normalized)];
}

async function executeUpload(ctx: IExecuteFunctions, index: number): Promise<IDataObject[]> {
	const node = ctx.getNode();
	const api: ApiCall = (method, endpoint, input) =>
		postSiderApiRequest.call(ctx, method, endpoint, input) as never;
	const source = String(ctx.getNodeParameter('uploadSource', index, 'binary'));
	let media;
	if (source === 'url') {
		const urls = parseUrlList(node, ctx.getNodeParameter('uploadUrls', index, ''));
		if (urls.length === 0) {
			throw new NodeOperationError(node, 'Media URLs must list at least one URL', { itemIndex: index });
		}
		media = await uploadFromUrls(api, urls);
	} else {
		const names = parseIdList(
			node,
			ctx.getNodeParameter('uploadBinaryProperties', index, 'data'),
			'Binary property names',
		);
		media = await uploadBinaries(ctx, api, index, names);
	}
	return media as unknown as IDataObject[];
}

function readParams(ctx: IExecuteFunctions, index: number, resource: string, operation: string): IDataObject {
	const get = (name: string, fallback?: unknown) => ctx.getNodeParameter(name, index, fallback);
	if (resource === 'media') {
		if (operation === 'getMany') return { page: get('page', 1), search: get('search', '') } as IDataObject;
		return { mediaId: get('mediaId', '') } as IDataObject;
	}
	if (resource === 'channel') {
		if (operation === 'getMany') {
			return { groupId: get('groupId', ''), includeDisabled: get('includeDisabled', false) } as IDataObject;
		}
		if (operation === 'getOptions') {
			return {
				channelId: get('channelId', ''),
				tool: get('tool', ''),
				toolData: get('toolData', {}),
			} as IDataObject;
		}
		return { channelId: get('channelId', ''), days: get('days', DEFAULT_ANALYTICS_DAYS) } as IDataObject;
	}
	if (resource === 'publishing') return { reason: get('reason', '') } as IDataObject;
	return {};
}

export async function executeOtherOperation(
	ctx: IExecuteFunctions,
	index: number,
	resource: string,
	operation: string,
): Promise<IDataObject[]> {
	const node = ctx.getNode();
	if (resource === 'media' && operation === 'upload') return executeUpload(ctx, index);
	if (CONTROL_RESOURCES.has(resource)) {
		const params = readControlParameters(ctx, resource, operation, index) ?? {};
		const response = await runControlRequest(ctx, resource, operation, params, index);
		return shapeOtherOutput(resource, operation, response, params);
	}
	const params = readParams(ctx, index, resource, operation);
	const request = buildOtherRequest(node, resource, operation, params, ctx.getExecutionId(), index);
	const response = await postSiderApiRequest.call(ctx, request.method, request.endpoint, request.input);
	return shapeOtherOutput(resource, operation, response, params);
}
