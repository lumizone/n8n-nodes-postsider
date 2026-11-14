import type { IDataObject, IExecuteFunctions, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { readControlParameters, runControlRequest } from '../shared/approvals';
import { extractList, normalizePostResponse, type OperationRequest } from '../shared/operations';
import { binaryFieldLabel, isCurrent } from '../shared/versions';
import { postSiderApiRequest, SLOW_REQUEST_TIMEOUT_MS } from '../shared/transport';
import { parseIdList, parseUrlList } from './inputs';
import { uploadBinaries, uploadFromUrls, type ApiCall } from './media';

const DEFAULT_ANALYTICS_DAYS = 7;
/** Resources that go through the shared (version 1) builders. Version 2 still includes Policy, as in 0.3.1. */
const CONTROL_RESOURCES = new Set(['approval', 'group']);
const LEGACY_CONTROL_RESOURCES = new Set(['approval', 'policy', 'group']);
const MEDIA_LIST_KEYS = ['results', 'media', 'items', 'data'];
const DEFAULT_MEDIA_LIMIT = 50;
const DEFAULT_LIST_LIMIT = 50;
/** Hard cap on the pages fetched for Media > Get Many (50 pages of 18 files). */
export const MAX_MEDIA_PAGES = 50;


function has(value: unknown): boolean {
	return value !== undefined && value !== null;
}

function required(node: INode, params: IDataObject, name: string, displayName: string): string {
	const value = String(params[name] ?? '').trim();
	if (!value) throw new NodeOperationError(node, `'${displayName}' is required`);
	return value;
}

function encodedId(node: INode, params: IDataObject, name: string, displayName: string): string {
	return encodeURIComponent(required(node, params, name, displayName));
}

function days(node: INode, params: IDataObject): number {
	const value = has(params.days) && params.days !== '' ? Number(params.days) : DEFAULT_ANALYTICS_DAYS;
	if (!Number.isFinite(value) || value < 1) {
		throw new NodeOperationError(node, "'Days' must be at least 1");
	}
	return Math.floor(value);
}

/** One page of the media library. The backend counts pages from 1 and returns 18 files per page. */
export function buildMediaListRequest(params: IDataObject, page: number): OperationRequest {
	const search = String(params.search ?? '').trim();
	return { method: 'GET', endpoint: '/media', input: { qs: { page, ...(search ? { search } : {}) } } };
}

function buildMediaRequest(node: INode, operation: string, params: IDataObject): OperationRequest {
	if (operation === 'getMany') {
		// Version 2 shows one page chosen with 'Page'; version 2.1 reads pages in fetchMediaFiles.
		const page = has(params.page) && params.page !== '' ? Number(params.page) : 1;
		if (!Number.isInteger(page) || page < 1) {
			throw new NodeOperationError(node, "'Page' must be a whole number of 1 or more");
		}
		return buildMediaListRequest(params, page);
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
			if (!methodName) throw new NodeOperationError(node, "'Option List Name or ID' is required");
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

/** Media list, delete, channel tools and publishing state. Approval, Group and Policy use the shared builder. */
export function buildOtherRequest(
	node: INode,
	resource: string,
	operation: string,
	params: IDataObject,
): OperationRequest {
	if (resource === 'media') return buildMediaRequest(node, operation, params);
	if (resource === 'channel') return buildChannelRequest(node, operation, params);
	if (resource === 'publishing') return buildPublishingRequest(node, operation, params);
	throw new NodeOperationError(node, `Unsupported PostSider operation: ${resource}.${operation}`);
}

function asObject(value: unknown): IDataObject {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return { value: value === null || value === undefined ? '' : String(value) };
	}
	return value as IDataObject;
}

/** The Limit of a list, or undefined when Return All is on or the version has no Limit. */
export function listLimit(node: INode, params: IDataObject): number | undefined {
	if (params.returnAll || !has(params.limit) || params.limit === '') return undefined;
	const limit = Number(params.limit);
	if (!Number.isInteger(limit) || limit < 1) {
		throw new NodeOperationError(node, "'Limit' must be a whole number of 1 or more");
	}
	return limit;
}

function sliceTo<T>(rows: T[], params: IDataObject): T[] {
	const limit = has(params.limit) && !params.returnAll ? Number(params.limit) : undefined;
	return limit !== undefined && Number.isInteger(limit) && limit >= 1 ? rows.slice(0, limit) : rows;
}

/**
 * `current` is false for node version 2, which keeps the output of 0.3.1. From 2.1 on, Get Many of
 * channels and groups honour Return All and Limit, and an empty analytics answer is one item `{ data: [] }`.
 */
export function shapeOtherOutput(
	resource: string,
	operation: string,
	response: unknown,
	params: IDataObject,
	current = true,
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
		return sliceTo(keep, params).map(asObject);
	}
	if (resource === 'group' && operation === 'getMany' && Array.isArray(normalized)) {
		return sliceTo(normalized, params).map(asObject);
	}
	// Only node version 2 can reach Policy; it keeps the output of 0.3.1.
	if (resource === 'policy' && operation === 'getMany') return extractList(normalized).map(asObject);
	if (current && resource === 'channel' && operation === 'getAnalytics' && Array.isArray(normalized)) {
		return normalized.length === 0 ? [{ data: [] }] : normalized.map(asObject);
	}
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
			throw new NodeOperationError(node, "'Media URLs' must list at least one URL", { itemIndex: index });
		}
		media = await uploadFromUrls(node, api, urls);
	} else {
		const label = binaryFieldLabel(isCurrent(ctx));
		const names = parseIdList(node, ctx.getNodeParameter('uploadBinaryProperties', index, 'data'), label);
		media = await uploadBinaries(ctx, api, index, names, label);
	}
	return media as unknown as IDataObject[];
}

/**
 * Reads the parameters of an operation. Version 2.1 keeps optional fields in collections ('Filters',
 * 'Additional Fields'); version 2 reads them from the top level, where 0.3.1 declared them.
 */
function readParams(
	ctx: IExecuteFunctions,
	index: number,
	resource: string,
	operation: string,
	current: boolean,
): IDataObject {
	const get = (name: string, fallback?: unknown) => ctx.getNodeParameter(name, index, fallback);
	if (resource === 'media') {
		if (operation === 'getMany') {
			if (!current) return { page: get('page', 1), search: get('search', '') } as IDataObject;
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
			if (!current) {
				return { groupId: get('groupId', ''), includeDisabled: get('includeDisabled', false) } as IDataObject;
			}
			const filters = get('channelFilters', {}) as IDataObject;
			return {
				groupId: filters.groupId ?? '',
				includeDisabled: filters.includeDisabled ?? false,
				returnAll: get('returnAll', false),
				limit: get('limit', DEFAULT_LIST_LIMIT),
			} as IDataObject;
		}
		if (operation === 'getOptions') {
			const extra = current ? (get('getOptionsAdditionalFields', {}) as IDataObject) : undefined;
			return {
				channelId: get('channelId', ''),
				tool: get('tool', ''),
				toolData: extra ? (extra.toolData ?? {}) : get('toolData', {}),
			} as IDataObject;
		}
		return { channelId: get('channelId', ''), days: get('days', DEFAULT_ANALYTICS_DAYS) } as IDataObject;
	}
	if (resource === 'publishing') {
		if (!current) return { reason: get('reason', '') } as IDataObject;
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
	const current = isCurrent(ctx);
	if (resource === 'media' && operation === 'upload') return executeUpload(ctx, index);
	if ((current ? CONTROL_RESOURCES : LEGACY_CONTROL_RESOURCES).has(resource)) {
		const params = readControlParameters(ctx, resource, operation, index) ?? {};
		if (current && resource === 'group' && operation === 'getMany') {
			params.returnAll = ctx.getNodeParameter('returnAll', index, false) as boolean;
			params.limit = ctx.getNodeParameter('limit', index, DEFAULT_LIST_LIMIT) as number;
			listLimit(node, params);
		}
		const response = await runControlRequest(ctx, resource, operation, params, index);
		return shapeOtherOutput(resource, operation, response, params, current);
	}
	const params = readParams(ctx, index, resource, operation, current);
	if (current && resource === 'channel' && operation === 'getMany') listLimit(node, params);
	if (current && resource === 'media' && operation === 'getMany') {
		const files = await fetchMediaFiles(ctx, params);
		return shapeOtherOutput(resource, operation, files, params, current);
	}
	const request = buildOtherRequest(node, resource, operation, params);
	const response = await postSiderApiRequest.call(ctx, request.method, request.endpoint, request.input);
	return shapeOtherOutput(resource, operation, response, params, current);
}
