import type { IDataObject, IExecuteFunctions, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { readControlParameters, runControlRequest } from '../shared/approvals';
import {
	buildOperationRequest,
	extractList,
	normalizePostResponse,
	type OperationRequest,
} from '../shared/operations';
import { executionScope } from '../shared/idempotency';
import { postSiderApiRequest, SLOW_REQUEST_TIMEOUT_MS } from '../shared/transport';
import { parseIdList, parseUrlList } from './inputs';
import { uploadBinaries, uploadFromUrls, type ApiCall } from './media';

const DEFAULT_ANALYTICS_DAYS = 7;
const CONTROL_RESOURCES = new Set(['approval', 'policy', 'group']);
const MEDIA_LIST_KEYS = ['results', 'media', 'items', 'data'];
const DEFAULT_MEDIA_LIMIT = 50;
/** Hard cap on the pages fetched for Media > Get Many (50 pages of 18 files). */
export const MAX_MEDIA_PAGES = 50;


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

/** One page of the media library. The backend counts pages from 1 and returns 18 files per page. */
export function buildMediaListRequest(params: IDataObject, page: number): OperationRequest {
	const search = String(params.search ?? '').trim();
	return { method: 'GET', endpoint: '/media', input: { qs: { page, ...(search ? { search } : {}) } } };
}

function buildMediaRequest(node: INode, operation: string, params: IDataObject): OperationRequest {
	if (operation === 'getMany') return buildMediaListRequest(params, 1);
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
				input: { body: { methodName, data }, timeout: SLOW_REQUEST_TIMEOUT_MS },
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

function mediaRows(response: unknown): unknown[] {
	const normalized = normalizePostResponse(response);
	if (Array.isArray(normalized)) return normalized;
	const record = (normalized ?? {}) as Record<string, unknown>;
	for (const key of MEDIA_LIST_KEYS) {
		if (Array.isArray(record[key])) return record[key] as unknown[];
	}
	return [];
}

/**
 * Media > Get Many. `GET /media?page=N` answers `{ pages, results }` with 18 files per page, counted
 * from page 1. Pages are fetched until the limit is met (or all of them with Return All), never more
 * than MAX_MEDIA_PAGES.
 */
export async function fetchMediaFiles(ctx: IExecuteFunctions, params: IDataObject): Promise<unknown[]> {
	const node = ctx.getNode();
	const returnAll = Boolean(params.returnAll);
	const limit = has(params.limit) && params.limit !== '' ? Number(params.limit) : DEFAULT_MEDIA_LIMIT;
	if (!returnAll && (!Number.isInteger(limit) || limit < 1)) {
		throw new NodeOperationError(node, "'Limit' must be a whole number of 1 or more");
	}
	const files: unknown[] = [];
	for (let page = 1; page <= MAX_MEDIA_PAGES; page++) {
		const request = buildMediaListRequest(params, page);
		const response = await postSiderApiRequest.call(ctx, request.method, request.endpoint, request.input);
		const rows = mediaRows(response);
		files.push(...rows);
		const pages = Number((response as { pages?: unknown } | null | undefined)?.pages);
		if (rows.length === 0 || !Number.isFinite(pages) || page >= pages) break;
		if (!returnAll && files.length >= limit) break;
	}
	return returnAll ? files : files.slice(0, limit);
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
		media = await uploadFromUrls(node, api, urls);
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
		if (operation === 'getMany') {
			const filters = get('mediaFilters', {}) as IDataObject;
			return {
				returnAll: get('returnAll', false),
				limit: get('limit', DEFAULT_MEDIA_LIMIT),
				search: filters.search ?? '',
			} as IDataObject;
		}
		return { mediaId: get('mediaId', '') } as IDataObject;
	}
	if (resource === 'channel') {
		if (operation === 'getMany') {
			const filters = get('channelFilters', {}) as IDataObject;
			return {
				groupId: filters.groupId ?? '',
				includeDisabled: filters.includeDisabled ?? false,
			} as IDataObject;
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
	if (resource === 'publishing') {
		const extra = get('pauseAdditionalFields', {}) as IDataObject;
		return { reason: extra.reason ?? '' } as IDataObject;
	}
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
	if (resource === 'media' && operation === 'getMany') {
		const files = await fetchMediaFiles(ctx, params);
		return shapeOtherOutput(resource, operation, files, params);
	}
	const request = buildOtherRequest(node, resource, operation, params, executionScope(ctx), index);
	const response = await postSiderApiRequest.call(ctx, request.method, request.endpoint, request.input);
	return shapeOtherOutput(resource, operation, response, params);
}
