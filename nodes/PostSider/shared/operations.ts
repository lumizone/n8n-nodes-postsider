import type { IDataObject, IHttpRequestMethods } from 'n8n-workflow';

import {
	buildCreatePostBody,
	normalizeScheduledDate,
	parseJsonObject,
	type ChannelPostInput,
	type PostSiderMedia,
	type PostSiderTag,
	type PostType,
} from './payloads';

export interface OperationRequest {
	method: IHttpRequestMethods;
	endpoint: string;
	input: {
		body?: IDataObject | IDataObject[];
		qs?: IDataObject;
		headers?: IDataObject;
	};
}

interface ChannelPostCollection {
	channelPost?: Array<{
		channelId?: string;
		content?: string;
		firstComment?: string;
		mediaJson?: string;
		settingsJson?: string;
	}>;
}

function requiredString(parameters: IDataObject, name: string, displayName: string): string {
	const value = String(parameters[name] ?? '').trim();
	if (!value) throw new Error(`${displayName} is required`);
	return value;
}

function parseArray<T>(value: unknown, displayName: string): T[] {
	if (value === undefined || value === null || value === '') return [];
	let parsed: unknown;
	try {
		parsed = typeof value === 'string' ? JSON.parse(value) : value;
	} catch {
		throw new Error(`${displayName} must contain valid JSON`);
	}
	if (!Array.isArray(parsed)) throw new Error(`${displayName} must be a JSON array`);
	return parsed as T[];
}

function validateMedia(media: PostSiderMedia[]): PostSiderMedia[] {
	for (const item of media) {
		if (!item || typeof item !== 'object' || !String(item.id ?? '') || !String(item.path ?? '')) {
			throw new Error('Media JSON entries must include non-empty id and path fields');
		}
	}
	return media;
}

function validateIdempotencyKey(value: string): string {
	if (!/^[A-Za-z0-9._:-]{1,255}$/.test(value)) {
		throw new Error(
			'Idempotency Key must be 1 to 255 characters and use only letters, numbers, dot, underscore, colon, or hyphen',
		);
	}
	return value;
}

function buildCreateRequest(
	parameters: IDataObject,
	executionId: string,
	itemIndex: number,
	now: () => Date,
): OperationRequest {
	const type = String(parameters.type ?? 'draft') as PostType;
	if (type !== 'draft' && type !== 'schedule') {
		throw new Error('Post Type must be Draft or Schedule');
	}
	const publishDate = String(parameters.publishDate ?? '').trim();
	if (type === 'schedule' && !publishDate) throw new Error('Publish Date is required for scheduled posts');
	const current = now();
	const date =
		type === 'draft'
			? new Date(
					Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()),
				).toISOString()
			: normalizeScheduledDate(publishDate);
	const collection = (parameters.channelPosts ?? {}) as ChannelPostCollection;
	const entries = collection.channelPost ?? [];
	if (entries.length === 0) throw new Error('At least one Channel Post is required');
	const channels: ChannelPostInput[] = entries.map((entry) => {
		const channelId = String(entry.channelId ?? '').trim();
		const content = String(entry.content ?? '');
		if (!channelId) throw new Error('Channel is required for every Channel Post');
		if (!content.trim()) throw new Error('Content is required for every Channel Post');
		return {
			channelId,
			content,
			...(entry.firstComment ? { firstComment: entry.firstComment } : {}),
			media: validateMedia(parseArray<PostSiderMedia>(entry.mediaJson, 'Media JSON')),
			settings: parseJsonObject(entry.settingsJson || '{}', 'Settings JSON'),
		};
	});
	const tags = parseArray<PostSiderTag>(parameters.tagsJson, 'Tags JSON');
	const suppliedKey = String(parameters.idempotencyKey ?? '').trim();
	const idempotencyKey = validateIdempotencyKey(
		suppliedKey || `n8n:${executionId}:item:${itemIndex}`,
	);
	return {
		method: 'POST',
		endpoint: '/posts',
		input: {
			body: buildCreatePostBody({
				type,
				date,
				shortLink: Boolean(parameters.shortLink),
				tags,
				channels,
			}) as unknown as IDataObject,
			headers: { 'Idempotency-Key': idempotencyKey },
		},
	};
}

function encodedId(parameters: IDataObject, name: string, displayName: string): string {
	return encodeURIComponent(requiredString(parameters, name, displayName));
}

export function buildOperationRequest(
	resource: string,
	operation: string,
	parameters: IDataObject,
	executionId: string,
	itemIndex: number,
	now: () => Date = () => new Date(),
): OperationRequest {
	if (resource === 'channel' && operation === 'getMany') {
		const groupId = String(parameters.groupId ?? '').trim();
		return {
			method: 'GET',
			endpoint: '/integrations',
			input: groupId ? { qs: { group: groupId } } : {},
		};
	}
	if (resource === 'group' && operation === 'getMany') {
		return { method: 'GET', endpoint: '/groups', input: {} };
	}
	if (resource === 'post' && operation === 'create') {
		return buildCreateRequest(parameters, executionId, itemIndex, now);
	}
	if (resource === 'post' && operation === 'get') {
		return {
			method: 'GET',
			endpoint: `/posts/${encodedId(parameters, 'postId', 'Post ID')}`,
			input: {},
		};
	}
	if (resource === 'post' && operation === 'getMany') {
		const groupId = String(parameters.groupId ?? '').trim();
		return {
			method: 'GET',
			endpoint: '/posts',
			input: {
				qs: {
					startDate: requiredString(parameters, 'startDate', 'Start Date'),
					endDate: requiredString(parameters, 'endDate', 'End Date'),
					...(groupId ? { customer: groupId } : {}),
				},
			},
		};
	}
	if (resource === 'scheduling' && operation === 'findNextSlot') {
		return {
			method: 'GET',
			endpoint: `/find-slot/${encodedId(parameters, 'channelId', 'Channel')}`,
			input: {},
		};
	}
	if (resource === 'approval' && operation === 'getStatus') {
		return {
			method: 'GET',
			endpoint: `/posts/${encodedId(parameters, 'postId', 'Post ID')}/approval`,
			input: {},
		};
	}
	if (resource === 'media' && operation === 'importFromUrl') {
		const value = requiredString(parameters, 'url', 'URL');
		let url: URL;
		try {
			url = new URL(value);
		} catch {
			throw new Error('URL must be a valid public HTTPS URL');
		}
		if (url.protocol !== 'https:' || url.username || url.password) {
			throw new Error('URL must be a valid public HTTPS URL');
		}
		return {
			method: 'POST',
			endpoint: '/upload-from-url',
			input: { body: { url: url.toString() } },
		};
	}
	throw new Error(`Unsupported PostSider operation: ${resource}.${operation}`);
}

function normalizeImage(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return value;
	}
}

export function normalizePostResponse(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(normalizePostResponse);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, entry]) => [
			key,
			key === 'image' ? normalizeImage(entry) : normalizePostResponse(entry),
		]),
	);
}

export function simplifyPostResponse(value: Record<string, unknown>): Record<string, unknown> {
	const integration =
		value.integration && typeof value.integration === 'object' && !Array.isArray(value.integration)
			? (value.integration as Record<string, unknown>)
			: {};
	const simplified: Record<string, unknown> = {};
	for (const key of ['id', 'content', 'publishDate', 'state', 'releaseURL', 'group', 'image']) {
		if (Object.prototype.hasOwnProperty.call(value, key)) simplified[key] = value[key];
	}
	if (integration.id !== undefined) simplified.integrationId = integration.id;
	if (integration.name !== undefined) simplified.integrationName = integration.name;
	if (integration.providerIdentifier !== undefined) {
		simplified.provider = integration.providerIdentifier;
	}
	return simplified;
}
