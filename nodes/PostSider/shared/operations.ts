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

const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];
const POLICY_POST_TYPES = ['draft', 'schedule', 'now'];
const MAX_NOTE_LENGTH = 500;
const MAX_NAME_LENGTH = 100;
const DEFAULT_APPROVAL_LIMIT = 25;
const MAX_APPROVAL_LIMIT = 100;
export const MAX_APPROVAL_PAGES = 10;

function executionKey(executionId: string, itemIndex: number): IDataObject {
	return {
		'Idempotency-Key': validateIdempotencyKey(`n8n:${executionId}:item:${itemIndex}`),
	};
}

function groupName(parameters: IDataObject): string {
	const name = requiredString(parameters, 'groupName', 'Group Name');
	if (name.length > MAX_NAME_LENGTH) {
		throw new Error(`Group Name must be at most ${MAX_NAME_LENGTH} characters`);
	}
	return name;
}

function buildDecisionRequest(
	decision: 'approve' | 'reject',
	parameters: IDataObject,
	executionId: string,
	itemIndex: number,
): OperationRequest {
	const id = encodedId(parameters, 'approvalId', 'Approval ID');
	const note = String(parameters.note ?? '').trim();
	if (note.length > MAX_NOTE_LENGTH) {
		throw new Error(`Note must be at most ${MAX_NOTE_LENGTH} characters`);
	}
	return {
		method: 'POST',
		endpoint: `/approvals/${id}/${decision}`,
		input: {
			body: note ? { note } : {},
			headers: executionKey(executionId, itemIndex),
		},
	};
}

function buildApprovalListRequest(parameters: IDataObject): OperationRequest {
	const status = String(parameters.status ?? '').trim().toUpperCase();
	if (status && !APPROVAL_STATUSES.includes(status)) {
		throw new Error('Status must be Pending, Approved or Rejected');
	}
	const since = String(parameters.since ?? '').trim();
	const returnAll = Boolean(parameters.returnAll);
	let limit = DEFAULT_APPROVAL_LIMIT;
	if (returnAll) {
		limit = MAX_APPROVAL_LIMIT;
	} else if (parameters.limit !== undefined && parameters.limit !== '') {
		limit = Number(parameters.limit);
		if (!Number.isInteger(limit) || limit < 1 || limit > MAX_APPROVAL_LIMIT) {
			throw new Error(`Limit must be a whole number from 1 to ${MAX_APPROVAL_LIMIT}`);
		}
	}
	const cursor = String(parameters.cursor ?? '').trim();
	return {
		method: 'GET',
		endpoint: '/approvals',
		input: {
			qs: {
				...(status ? { status } : {}),
				...(since ? { since: normalizeScheduledDate(since) } : {}),
				limit,
				...(cursor ? { cursor } : {}),
			},
		},
	};
}

function buildPolicyCheckRequest(parameters: IDataObject): OperationRequest {
	const type = String(parameters.type ?? 'draft');
	if (!POLICY_POST_TYPES.includes(type)) {
		throw new Error('Post Type must be Draft, Schedule or Now');
	}
	const publishDate = String(parameters.publishDate ?? '').trim();
	if (type === 'schedule' && !publishDate) throw new Error('Publish Date is required for scheduled posts');
	const collection = (parameters.channelPosts ?? {}) as ChannelPostCollection;
	const entries = collection.channelPost ?? [];
	if (entries.length === 0) throw new Error('At least one Channel Post is required');
	if (entries.length > 20) throw new Error('At most 20 Channel Posts can be checked at once');
	const posts = entries.map((entry) => {
		const channelId = String(entry.channelId ?? '').trim();
		if (!channelId) throw new Error('Channel is required for every Channel Post');
		const media = validateMedia(parseArray<PostSiderMedia>(entry.mediaJson, 'Media JSON'));
		return {
			integration: { id: channelId },
			value: [
				{
					content: String(entry.content ?? ''),
					image: media.map((item) => ({ path: String(item.path) })),
				},
			],
			...(entry.firstComment ? { firstComment: entry.firstComment } : {}),
		};
	});
	return {
		method: 'POST',
		endpoint: '/policies/evaluate',
		input: {
			body: {
				type,
				...(type === 'schedule' && publishDate ? { date: normalizeScheduledDate(publishDate) } : {}),
				posts,
			} as unknown as IDataObject,
		},
	};
}

/** Pulls the item list out of a cursor-paginated list response. */
export function extractList(response: unknown): unknown[] {
	if (Array.isArray(response)) return response;
	if (response && typeof response === 'object') {
		for (const key of ['approvals', 'items', 'data', 'results']) {
			const value = (response as Record<string, unknown>)[key];
			if (Array.isArray(value)) return value;
		}
	}
	return [];
}

export function nextCursor(response: unknown): string | undefined {
	if (!response || typeof response !== 'object' || Array.isArray(response)) return undefined;
	const value = (response as Record<string, unknown>).nextCursor;
	return typeof value === 'string' && value ? value : undefined;
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
	if (resource === 'group' && operation === 'create') {
		return { method: 'POST', endpoint: '/customers', input: { body: { name: groupName(parameters) } } };
	}
	if (resource === 'group' && operation === 'update') {
		return {
			method: 'PUT',
			endpoint: `/customers/${encodedId(parameters, 'targetGroupId', 'Group ID')}`,
			input: { body: { name: groupName(parameters) } },
		};
	}
	if (resource === 'group' && operation === 'archive') {
		return {
			method: 'POST',
			endpoint: `/customers/${encodedId(parameters, 'targetGroupId', 'Group ID')}/archive`,
			input: {},
		};
	}
	if (resource === 'policy' && operation === 'check') return buildPolicyCheckRequest(parameters);
	if (resource === 'policy' && operation === 'getMany') {
		return { method: 'GET', endpoint: '/policies', input: {} };
	}
	if (resource === 'approval' && operation === 'request') {
		return {
			method: 'POST',
			endpoint: `/posts/${encodedId(parameters, 'postId', 'Post ID')}/request-approval`,
			input: {},
		};
	}
	if (resource === 'approval' && operation === 'getMany') return buildApprovalListRequest(parameters);
	if (resource === 'approval' && (operation === 'approve' || operation === 'reject')) {
		return buildDecisionRequest(operation, parameters, executionId, itemIndex);
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
