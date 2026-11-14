import type { IDataObject, IExecuteFunctions, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { normalizeScheduledDate, parseJsonObject } from '../shared/payloads';
import {
	normalizePostResponse,
	simplifyPostFlat,
	simplifyPostResponse,
	type OperationRequest,
} from '../shared/operations';
import { binaryFieldLabel, dateZone, isCurrent } from '../shared/versions';
import { postSiderApiRequest, SLOW_REQUEST_TIMEOUT_MS } from '../shared/transport';
import { parseIdList, parseMediaJson, parseUrlList } from './inputs';
import { uploadBinaries, uploadFromUrls, type ApiCall } from './media';
import { buildChannelSettings, type PlatformSettingsInput } from './platformSettings';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 50;
const CONTENT_MAX = 4000;
const CHECK_PLATFORMS_MAX = 3;
const CHECK_MEDIA_TYPES = ['image', 'mixed', 'none', 'video'];
const DEFAULT_ANALYTICS_DAYS = 7;

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

/** The time zone for dates without one, set by the executor from node version 2.1 on. */
function zoneOf(params: IDataObject): string | undefined {
	return typeof params.timezone === 'string' && params.timezone ? params.timezone : undefined;
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
			throw new NodeOperationError(node, "Custom range needs both 'Start Date' and 'End Date'");
		}
		start = normalizeScheduledDate(node, from, 'Start Date', zoneOf(params));
		end = normalizeScheduledDate(node, to, 'End Date', zoneOf(params));
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
		body.date = normalizeScheduledDate(node, String(params.date).trim(), 'Date', zoneOf(params));
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
	if (!content.trim()) throw new NodeOperationError(node, "'Text' is required");
	if (content.length > CONTENT_MAX) {
		throw new NodeOperationError(node, `'Text' must be at most ${CONTENT_MAX} characters`);
	}
	const platforms = Array.isArray(params.platforms) ? (params.platforms as string[]) : [];
	if (platforms.length === 0) {
		throw new NodeOperationError(node, "Choose at least one platform in 'Platforms'");
	}
	if (platforms.length > CHECK_PLATFORMS_MAX) {
		throw new NodeOperationError(node, `Choose at most ${CHECK_PLATFORMS_MAX} platforms in 'Platforms'`);
	}
	const mediaType = String(params.mediaType ?? 'none');
	if (!CHECK_MEDIA_TYPES.includes(mediaType)) {
		throw new NodeOperationError(node, "'Media Type' must be Image, Mixed, None or Video");
	}
	// The backend takes a hasMedia flag and an optional mediaType (image, video, mixed).
	const hasMedia = mediaType !== 'none';
	return {
		content,
		hasMedia,
		...(hasMedia ? { mediaType } : {}),
		platforms,
	};
}

function buildRewriteBody(node: INode, params: IDataObject): IDataObject {
	const content = String(params.text ?? '');
	if (!content.trim()) throw new NodeOperationError(node, "'Text' is required");
	if (content.length > CONTENT_MAX) {
		throw new NodeOperationError(node, `'Text' must be at most ${CONTENT_MAX} characters`);
	}
	const body: IDataObject = { content };
	if (params.tone) body.tone = String(params.tone);
	if (has(params.count)) {
		const count = Number(params.count);
		if (!Number.isInteger(count) || count < 1 || count > 5) {
			throw new NodeOperationError(node, "'Number of Versions' must be a whole number between 1 and 5");
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
			if (date) body.date = normalizeScheduledDate(node, date, 'Date', zoneOf(params));
			return {
				method: 'POST',
				endpoint: `/posts/${encodedId(node, params, 'postId', 'Post ID')}/duplicate`,
				input: { body },
			};
		}
		case 'changeStatus': {
			const status = String(params.status ?? 'schedule');
			if (status !== 'draft' && status !== 'schedule') {
				throw new NodeOperationError(node, "'Status' must be Draft or Schedule");
			}
			return {
				method: 'PUT',
				endpoint: `/posts/${encodedId(node, params, 'postId', 'Post ID')}/status`,
				input: { body: { status } },
			};
		}
		case 'retryFailed':
			// Node version 2 reads the 'Group ID' of 0.3.1 (`postGroup`) and keeps its route.
			if (params.postGroup !== undefined) {
				return {
					method: 'POST',
					endpoint: `/posts/group/${encodedId(node, params, 'postGroup', 'Group ID')}/retry-failed`,
					input: { body: {} },
				};
			}
			return {
				method: 'POST',
				endpoint: `/posts/${encodedId(node, params, 'postId', 'Post ID')}/retry`,
				input: {},
			};
		case 'check':
			return {
				method: 'POST',
				endpoint: '/posts/check',
				input: { body: buildCheckBody(node, params), timeout: SLOW_REQUEST_TIMEOUT_MS },
			};
		case 'rewrite':
			return {
				method: 'POST',
				endpoint: '/posts/rewrite',
				input: { body: buildRewriteBody(node, params), timeout: SLOW_REQUEST_TIMEOUT_MS },
			};
		case 'getAnalytics': {
			const days = has(params.days) ? Number(params.days) : DEFAULT_ANALYTICS_DAYS;
			if (!Number.isFinite(days) || days < 1) {
				throw new NodeOperationError(node, "'Days' must be at least 1");
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
export function providerOfPost(node: INode, detail: unknown): string {
	const posts = (detail as { posts?: Array<{ integration?: { providerIdentifier?: unknown } }> } | undefined)
		?.posts;
	const provider = posts?.[0]?.integration?.providerIdentifier;
	if (typeof provider !== 'string' || !provider) {
		throw new NodeOperationError(
			node,
			'Could not read the channel provider of this post, so platform settings cannot be applied',
		);
	}
	return provider;
}

function asObject(value: unknown): IDataObject {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return { value: value === null || value === undefined ? '' : String(value) };
	}
	return value as IDataObject;
}

/** The fields Retry Failed returns. Nothing else from the response is passed on. */
export const RETRY_OUTPUT_FIELDS = ['state', 'publishDate', 'releaseURL', 'error', 'errorCode'] as const;

/**
 * `POST /posts/:id/retry` answers the whole post row, including its channel with the decrypted access and
 * refresh tokens. Only a fixed list of fields is copied, so no credential can reach the node output.
 * `postId` is the ID of the response, or the requested one when the response has none.
 */
function shapeRetryOutput(response: unknown, requestedPostId: unknown): IDataObject[] {
	const row =
		response && typeof response === 'object' && !Array.isArray(response)
			? (response as Record<string, unknown>)
			: {};
	const pick = (key: string): unknown => (row[key] === undefined ? null : row[key]);
	const id = row.id === undefined || row.id === null || row.id === '' ? requestedPostId : row.id;
	const output: IDataObject = { postId: (id ?? null) as IDataObject[string] };
	for (const key of RETRY_OUTPUT_FIELDS) output[key] = pick(key) as IDataObject[string];
	return [output];
}

const SECRET_KEYS = new Set(['token', 'accesstoken', 'refreshtoken', 'access_token', 'refresh_token']);

/** Removes channel tokens from a response, at any depth. No node version may output them. */
export function withoutSecrets(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(withoutSecrets);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(
		Object.entries(value)
			.filter(([key]) => !SECRET_KEYS.has(key.toLowerCase()))
			.map(([key, entry]) => [key, withoutSecrets(entry)]),
	);
}

function timeOf(post: unknown): number {
	const time = Date.parse(String((post as { publishDate?: unknown } | null)?.publishDate ?? ''));
	return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

/**
 * Production answers `GET /posts` unordered and repeats a recurring post. Sorted by publish date, then ID,
 * and an exact repeat of ID and publish date dropped.
 */
export function sortedUniquePosts(posts: unknown[]): unknown[] {
	const id = (post: unknown) => String((post as { id?: unknown } | null)?.id ?? '');
	const seen = new Set<string>();
	const unique = posts.filter((post) => {
		const key = `${id(post)}|${String((post as { publishDate?: unknown } | null)?.publishDate ?? '')}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	return unique.sort((a, b) => timeOf(a) - timeOf(b) || id(a).localeCompare(id(b)));
}

/**
 * `current` is false for node version 2, which keeps the output of 0.3.1: Retry Failed answers the
 * response (without channel tokens), Delete answers the response, and a simplified post keeps the longer
 * shape with its group and image.
 */
export function shapePostOutput(
	operation: string,
	response: unknown,
	params: IDataObject,
	current = true,
): IDataObject[] {
	if (operation === 'retryFailed') {
		if (!current) {
			const legacy = withoutSecrets(normalizePostResponse(response));
			return Array.isArray(legacy) ? legacy.map(asObject) : [asObject(legacy)];
		}
		return shapeRetryOutput(response, params.postId);
	}
	const normalized = normalizePostResponse(response);
	const simplify = params.simplify === undefined ? true : Boolean(params.simplify);
	// The backend deletes the post group and answers with it; from 2.1 n8n answers `deleted: true`.
	if (current && operation === 'delete') {
		return [{ postId: String(params.postId ?? ''), deleted: true }];
	}
	if (operation === 'getMany') {
		const raw =
			normalized && typeof normalized === 'object' && !Array.isArray(normalized)
				? (normalized as { posts?: unknown }).posts
				: normalized;
		let posts = Array.isArray(raw) ? raw : [];
		if (current) posts = sortedUniquePosts(posts);
		if (!params.returnAll) {
			const limit = Number(params.limit);
			posts = posts.slice(0, Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : DEFAULT_LIMIT);
		}
		return posts.map((post) =>
			simplify && post && typeof post === 'object'
				? ((current
						? simplifyPostFlat(post as Record<string, unknown>)
						: simplifyPostResponse(post as Record<string, unknown>)) as IDataObject)
				: asObject(post),
		);
	}
	if (operation === 'get' && simplify) {
		const detail = asObject(normalized);
		const posts = Array.isArray(detail.posts) ? (detail.posts as Array<Record<string, unknown>>) : [];
		if (current) {
			// Flat: the main post (the first one) with its channel; the follow-up posts are left out.
			return [simplifyPostFlat(posts[0] ?? {}, detail.integration) as IDataObject];
		}
		return [
			{
				group: detail.group,
				integration: detail.integration,
				integrationPicture: detail.integrationPicture,
				settings: detail.settings,
				posts: posts.map((post) => simplifyPostResponse(post)),
			} as IDataObject,
		];
	}
	if (current && operation === 'getAnalytics' && Array.isArray(normalized) && normalized.length === 0) {
		return [{ data: [] }];
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
	const current = isCurrent(ctx);

	const params: IDataObject = { timezone: dateZone(ctx) };
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
		case 'changeStatus':
			params.postId = get('postId', '');
			params.status = get('status', 'schedule');
			break;
		case 'duplicate': {
			const options = get('duplicateOptions', {}) as IDataObject;
			params.postId = get('postId', '');
			params.channelId = options.channelId;
			params.date = options.date;
			break;
		}
		case 'retryFailed':
			if (current) params.postId = get('postId', '');
			else params.postGroup = get('postGroup', '');
			break;
		case 'check': {
			params.text = get('text', '');
			params.platforms = get('platforms', []);
			if (current) {
				const options = get('checkOptions', {}) as IDataObject;
				params.mediaType = options.mediaType ?? 'none';
			} else {
				// Version 2 has 'Has Media' and 'Media Type' as separate fields.
				params.mediaType = get('hasMedia', false) ? String(get('mediaType', 'image')) : 'none';
			}
			break;
		}
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
			return executeUpdate(ctx, index, api, params, current);
		default:
			throw new NodeOperationError(node, `Unsupported PostSider post operation: ${operation}`, {
				itemIndex: index,
			});
	}
	const request = buildPostRequest(node, operation, params, now());
	const response = await api<unknown>(request.method, request.endpoint, request.input);
	return shapePostOutput(operation, response, params, current);
}

async function executeUpdate(
	ctx: IExecuteFunctions,
	index: number,
	api: ApiCall,
	params: IDataObject,
	current: boolean,
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
		binaryNames = parseIdList(node, get('updateBinaryProperties', 'data'), binaryFieldLabel(current));
		params.images = [];
	} else if (mediaSource === 'url') {
		mediaUrls = parseUrlList(node, get('updateMediaUrls', ''));
		params.images = [];
	} else if (mediaSource === 'uploaded') {
		const uploaded = parseMediaJson(node, get('updateMediaJson', '[]'));
		if (uploaded.length === 0) {
			throw new NodeOperationError(
				node,
				"'Media JSON' is empty. To delete the media of the post, choose 'Remove All Media' instead.",
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
			providerOfPost(node, detail),
			platform,
			settingsJson,
			storedSettings && typeof storedSettings === 'object' && !Array.isArray(storedSettings)
				? (storedSettings as Record<string, unknown>)
				: {},
		);
	}
	if (mediaSource === 'binary') params.images = await uploadBinaries(ctx, api, index, binaryNames, binaryFieldLabel(current));
	else if (mediaSource === 'url') params.images = await uploadFromUrls(node, api, mediaUrls);

	const request = buildPostRequest(node, 'update', params, new Date());
	const response = await api<unknown>(request.method, request.endpoint, request.input);
	return shapePostOutput('update', response, params, current);
}
