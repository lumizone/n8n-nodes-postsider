import type { IDataObject, IExecuteFunctions, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { normalizeScheduledDate, parseJsonObject } from '../shared/payloads';
import {
	normalizePostResponse,
	simplifyPostResponse,
	type OperationRequest,
} from '../shared/operations';
import { postSiderApiRequest } from '../shared/transport';
import { parseIdList, parseMediaJson, parseUrlList } from './inputs';
import { uploadBinaries, uploadFromUrls, type ApiCall } from './media';
import { buildChannelSettings, type PlatformSettingsInput } from './platformSettings';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 50;
const CONTENT_MAX = 4000;
const CHECK_PLATFORMS_MAX = 3;
const DEFAULT_ANALYTICS_DAYS = 7;

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

function listRange(node: INode, params: IDataObject, now: Date): IDataObject {
	const range = String(params.range ?? 'next7');
	let start: string;
	let end: string;
	if (range === 'last7') {
		start = new Date(now.getTime() - 7 * DAY_MS).toISOString();
		end = now.toISOString();
	} else if (range === 'custom') {
		const from = String(params.startDate ?? '').trim();
		const to = String(params.endDate ?? '').trim();
		if (!from || !to) {
			throw new NodeOperationError(node, 'Custom range needs both a start date and an end date');
		}
		start = normalizeScheduledDate(node, from);
		end = normalizeScheduledDate(node, to);
	} else {
		start = now.toISOString();
		end = new Date(now.getTime() + 7 * DAY_MS).toISOString();
	}
	const qs: IDataObject = { startDate: start, endDate: end };
	const state = String(params.state ?? '');
	if (state && state !== 'any') qs.state = state;
	const channel = String(params.channel ?? '').trim();
	if (channel) qs.integration = channel;
	const groupId = String(params.groupId ?? '').trim();
	if (groupId) qs.customer = groupId;
	return qs;
}

function buildUpdateBody(node: INode, params: IDataObject): IDataObject {
	const body: IDataObject = {};
	if (has(params.text)) body.content = String(params.text);
	if (has(params.date) && String(params.date).trim() !== '') {
		body.date = normalizeScheduledDate(node, String(params.date).trim());
	}
	if (has(params.firstComment)) {
		const comment = String(params.firstComment);
		// An empty value clears the first comment; the backend contract for that is null.
		body.firstComment = comment === '' ? null : comment;
	}
	if (Array.isArray(params.images)) body.images = params.images as IDataObject[];
	const settings = params.settings as Record<string, unknown> | undefined;
	if (settings && Object.keys(settings).length > 0) body.settings = settings as IDataObject;
	if (Object.keys(body).length === 0) {
		throw new NodeOperationError(node, 'Set at least one field to update');
	}
	return body;
}

function buildCheckBody(node: INode, params: IDataObject): IDataObject {
	const content = String(params.text ?? '');
	if (!content.trim()) throw new NodeOperationError(node, 'Text is required');
	if (content.length > CONTENT_MAX) {
		throw new NodeOperationError(node, `Text must be at most ${CONTENT_MAX} characters`);
	}
	const platforms = Array.isArray(params.platforms) ? (params.platforms as string[]) : [];
	if (platforms.length === 0) {
		throw new NodeOperationError(node, 'Choose at least one platform to check against');
	}
	if (platforms.length > CHECK_PLATFORMS_MAX) {
		throw new NodeOperationError(node, `Choose at most ${CHECK_PLATFORMS_MAX} platforms to check against`);
	}
	const hasMedia = Boolean(params.hasMedia);
	return {
		content,
		hasMedia,
		...(hasMedia && params.mediaType ? { mediaType: String(params.mediaType) } : {}),
		platforms,
	};
}

function buildRewriteBody(node: INode, params: IDataObject): IDataObject {
	const content = String(params.text ?? '');
	if (!content.trim()) throw new NodeOperationError(node, 'Text is required');
	if (content.length > CONTENT_MAX) {
		throw new NodeOperationError(node, `Text must be at most ${CONTENT_MAX} characters`);
	}
	const body: IDataObject = { content };
	if (params.tone) body.tone = String(params.tone);
	if (has(params.count)) {
		const count = Number(params.count);
		if (!Number.isInteger(count) || count < 1 || count > 5) {
			throw new NodeOperationError(node, 'Number of versions must be a whole number between 1 and 5');
		}
		body.count = count;
	}
	if (params.platform) body.platform = String(params.platform);
	return body;
}

export function buildPostRequest(
	node: INode,
	operation: string,
	params: IDataObject,
	now: Date,
): OperationRequest {
	switch (operation) {
		case 'get':
			return {
				method: 'GET',
				endpoint: `/posts/${encodedId(node, params, 'postId', 'Post ID')}`,
				input: {},
			};
		case 'getMany':
			return { method: 'GET', endpoint: '/posts', input: { qs: listRange(node, params, now) } };
		case 'update':
			return {
				method: 'PUT',
				endpoint: `/posts/${encodedId(node, params, 'postId', 'Post ID')}`,
				input: { body: buildUpdateBody(node, params) },
			};
		case 'delete':
			return {
				method: 'DELETE',
				endpoint: `/posts/${encodedId(node, params, 'postId', 'Post ID')}`,
				input: {},
			};
		case 'duplicate': {
			const body: IDataObject = {};
			const channelId = String(params.channelId ?? '').trim();
			if (channelId) body.channelId = channelId;
			const date = String(params.date ?? '').trim();
			if (date) body.date = normalizeScheduledDate(node, date);
			return {
				method: 'POST',
				endpoint: `/posts/${encodedId(node, params, 'postId', 'Post ID')}/duplicate`,
				input: { body },
			};
		}
		case 'retryFailed':
			return {
				method: 'POST',
				endpoint: `/posts/group/${encodedId(node, params, 'postGroup', 'Group ID')}/retry-failed`,
				input: { body: {} },
			};
		case 'check':
			return { method: 'POST', endpoint: '/posts/check', input: { body: buildCheckBody(node, params) } };
		case 'rewrite':
			return { method: 'POST', endpoint: '/posts/rewrite', input: { body: buildRewriteBody(node, params) } };
		case 'getAnalytics': {
			const days = has(params.days) ? Number(params.days) : DEFAULT_ANALYTICS_DAYS;
			if (!Number.isFinite(days) || days < 1) {
				throw new NodeOperationError(node, 'Days must be at least 1');
			}
			return {
				method: 'GET',
				endpoint: `/analytics/post/${encodedId(node, params, 'postId', 'Post ID')}`,
				input: { qs: { date: Math.floor(days) } },
			};
		}
		default:
			throw new NodeOperationError(node, `Unsupported PostSider post operation: ${operation}`);
	}
}

/**
 * Settings for Update. The backend replaces the whole settings object (`patch.settings ?? stored`),
 * so a partial object would wipe stored keys. Start from the stored settings, apply the platform
 * fields the user filled in, then Settings JSON. No safe defaults are added.
 */
export function buildUpdateSettings(
	provider: string,
	options: PlatformSettingsInput,
	extra: Record<string, unknown>,
	stored: Record<string, unknown> = {},
): Record<string, unknown> {
	return { ...stored, ...buildChannelSettings(provider, '', options, extra, false) };
}

/** The provider of an existing post, read from `GET /posts/:id`. */
export function providerOfPost(detail: unknown): string {
	const posts = (detail as { posts?: Array<{ integration?: { providerIdentifier?: unknown } }> } | undefined)
		?.posts;
	const provider = posts?.[0]?.integration?.providerIdentifier;
	if (typeof provider !== 'string' || !provider) {
		throw new Error('Could not read the channel provider of this post, so platform settings cannot be applied');
	}
	return provider;
}

function asObject(value: unknown): IDataObject {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return { value: value === null || value === undefined ? '' : String(value) };
	}
	return value as IDataObject;
}

export function shapePostOutput(operation: string, response: unknown, params: IDataObject): IDataObject[] {
	const normalized = normalizePostResponse(response);
	const simplify = params.simplify === undefined ? true : Boolean(params.simplify);
	if (operation === 'getMany') {
		const raw =
			normalized && typeof normalized === 'object' && !Array.isArray(normalized)
				? (normalized as { posts?: unknown }).posts
				: normalized;
		let posts = Array.isArray(raw) ? raw : [];
		if (!params.returnAll) {
			const limit = Number(params.limit);
			posts = posts.slice(0, Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : DEFAULT_LIMIT);
		}
		return posts.map((post) =>
			simplify && post && typeof post === 'object'
				? (simplifyPostResponse(post as Record<string, unknown>) as IDataObject)
				: asObject(post),
		);
	}
	if (operation === 'get' && simplify) {
		const detail = asObject(normalized);
		const posts = Array.isArray(detail.posts)
			? detail.posts.map((post) => simplifyPostResponse(post as Record<string, unknown>))
			: [];
		return [
			{
				group: detail.group,
				integration: detail.integration,
				integrationPicture: detail.integrationPicture,
				settings: detail.settings,
				posts,
			} as IDataObject,
		];
	}
	if (Array.isArray(normalized)) return normalized.map(asObject);
	return [asObject(normalized)];
}

export async function executePostOperation(
	ctx: IExecuteFunctions,
	index: number,
	operation: string,
	now: () => Date = () => new Date(),
): Promise<IDataObject[]> {
	const node = ctx.getNode();
	const api: ApiCall = (method, endpoint, input) =>
		postSiderApiRequest.call(ctx, method, endpoint, input) as never;
	const get = (name: string, fallback?: unknown) => ctx.getNodeParameter(name, index, fallback);

	const params: IDataObject = {};
	switch (operation) {
		case 'get':
			params.postId = get('postId', '');
			params.simplify = get('simplify', true);
			break;
		case 'getMany': {
			const filters = get('filters', {}) as IDataObject;
			params.range = get('range', 'next7');
			params.startDate = get('startDate', '');
			params.endDate = get('endDate', '');
			params.state = filters.state;
			params.channel = filters.channel;
			params.groupId = filters.groupId;
			params.returnAll = get('returnAll', false);
			params.limit = get('limit', DEFAULT_LIMIT);
			params.simplify = get('simplify', true);
			break;
		}
		case 'delete':
			params.postId = get('postId', '');
			break;
		case 'duplicate': {
			const options = get('duplicateOptions', {}) as IDataObject;
			params.postId = get('postId', '');
			params.channelId = options.channelId;
			params.date = options.date;
			break;
		}
		case 'retryFailed':
			params.postGroup = get('postGroup', '');
			break;
		case 'check':
			params.text = get('text', '');
			params.hasMedia = get('hasMedia', false);
			params.mediaType = get('mediaType', 'image');
			params.platforms = get('platforms', []);
			break;
		case 'rewrite': {
			const options = get('rewriteOptions', {}) as IDataObject;
			params.text = get('text', '');
			params.tone = options.tone;
			params.count = options.count;
			params.platform = options.platform;
			break;
		}
		case 'getAnalytics':
			params.postId = get('postId', '');
			params.days = get('days', DEFAULT_ANALYTICS_DAYS);
			break;
		case 'update':
			return executeUpdate(ctx, index, api, params);
		default:
			throw new NodeOperationError(node, `Unsupported PostSider post operation: ${operation}`, {
				itemIndex: index,
			});
	}
	const request = buildPostRequest(node, operation, params, now());
	const response = await api<unknown>(request.method, request.endpoint, request.input);
	return shapePostOutput(operation, response, params);
}

async function executeUpdate(
	ctx: IExecuteFunctions,
	index: number,
	api: ApiCall,
	params: IDataObject,
): Promise<IDataObject[]> {
	const node = ctx.getNode();
	const get = (name: string, fallback?: unknown) => ctx.getNodeParameter(name, index, fallback);
	const fields = get('updateFields', {}) as IDataObject;
	params.postId = get('postId', '');
	params.text = fields.text;
	params.date = fields.date;
	params.firstComment = fields.firstComment;

	// Parse and validate everything first: nothing below may cost an upload before a bad input is caught.
	const mediaSource = String(get('updateMediaSource', 'keep'));
	let binaryNames: string[] = [];
	let mediaUrls: string[] = [];
	if (mediaSource === 'binary') {
		binaryNames = parseIdList(node, get('updateBinaryProperties', 'data'), 'Binary property names');
		params.images = [];
	} else if (mediaSource === 'url') {
		mediaUrls = parseUrlList(node, get('updateMediaUrls', ''));
		params.images = [];
	} else if (mediaSource === 'uploaded') {
		const uploaded = parseMediaJson(node, get('updateMediaJson', '[]'));
		if (uploaded.length === 0) {
			throw new NodeOperationError(
				node,
				'Media JSON is empty. To delete the media of the post, choose Remove All Media instead.',
				{ itemIndex: index },
			);
		}
		params.images = uploaded;
	} else if (mediaSource === 'remove') {
		params.images = [];
	}

	const platform = (fields.platformSettings ?? {}) as PlatformSettingsInput;
	const rawJson = fields.settingsJson;
	const settingsJson =
		rawJson === undefined || rawJson === null || rawJson === ''
			? {}
			: typeof rawJson === 'string'
				? parseJsonObject(node, rawJson, 'Settings JSON')
				: (rawJson as Record<string, unknown>);
	const wantsSettings = Object.keys(platform).length > 0 || Object.keys(settingsJson).length > 0;
	if (wantsSettings) params.settings = { placeholder: true };
	// Dry build: bad date or an empty update fails before the lookup or any upload.
	buildPostRequest(node, 'update', params, new Date());

	if (wantsSettings) {
		const detail = await api<unknown>(
			'GET',
			`/posts/${encodeURIComponent(required(node, params, 'postId', 'Post ID'))}`,
		);
		const storedSettings = (detail as { settings?: unknown } | undefined)?.settings;
		params.settings = buildUpdateSettings(
			providerOfPost(detail),
			platform,
			settingsJson,
			storedSettings && typeof storedSettings === 'object' && !Array.isArray(storedSettings)
				? (storedSettings as Record<string, unknown>)
				: {},
		);
	}
	if (mediaSource === 'binary') params.images = await uploadBinaries(ctx, api, index, binaryNames);
	else if (mediaSource === 'url') params.images = await uploadFromUrls(api, mediaUrls);

	const request = buildPostRequest(node, 'update', params, new Date());
	const response = await api<unknown>(request.method, request.endpoint, request.input);
	return shapePostOutput('update', response, params);
}
