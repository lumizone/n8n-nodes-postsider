import { createHash, randomUUID } from 'node:crypto';

import type { IDataObject, IHttpRequestMethods, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

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

function requiredString(
	node: INode,
	parameters: IDataObject,
	name: string,
	displayName: string,
): string {
	const value = String(parameters[name] ?? '').trim();
	if (!value) throw new NodeOperationError(node, `${displayName} is required`);
	return value;
}

function parseArray<T>(node: INode, value: unknown, displayName: string): T[] {
	if (value === undefined || value === null || value === '') return [];
	let parsed: unknown;
	try {
		parsed = typeof value === 'string' ? JSON.parse(value) : value;
	} catch {
		throw new NodeOperationError(node, `${displayName} must contain valid JSON`);
	}
	if (!Array.isArray(parsed)) throw new NodeOperationError(node, `${displayName} must be a JSON array`);
	return parsed as T[];
}

function validateMedia(node: INode, media: PostSiderMedia[]): PostSiderMedia[] {
	for (const item of media) {
		if (!item || typeof item !== 'object' || !String(item.id ?? '') || !String(item.path ?? '')) {
			throw new NodeOperationError(node, 'Media JSON entries must include non-empty id and path fields');
		}
	}
	return media;
}

export function validateIdempotencyKey(node: INode, value: string): string {
	if (!/^[A-Za-z0-9._:-]{1,255}$/.test(value)) {
		throw new NodeOperationError(
			node,
			'Idempotency Key must be 1 to 255 characters and use only letters, numbers, dot, underscore, colon, or hyphen',
		);
	}
	return value;
}

function buildCreateRequest(
	node: INode,
	parameters: IDataObject,
	executionId: string,
	itemIndex: number,
	now: () => Date,
): OperationRequest {
	const type = String(parameters.type ?? 'draft') as PostType;
	if (type !== 'draft' && type !== 'schedule') {
		throw new NodeOperationError(node, 'Post Type must be Draft or Schedule');
	}
	const publishDate = String(parameters.publishDate ?? '').trim();
	if (type === 'schedule' && !publishDate) throw new NodeOperationError(node, 'Publish Date is required for scheduled posts');
	const current = now();
	const date =
		type === 'draft'
			? new Date(
					Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()),
				).toISOString()
			: normalizeScheduledDate(node, publishDate);
	const collection = (parameters.channelPosts ?? {}) as ChannelPostCollection;
	const entries = collection.channelPost ?? [];
	if (entries.length === 0) throw new NodeOperationError(node, 'At least one Channel Post is required');
	const channels: ChannelPostInput[] = entries.map((entry) => {
		const channelId = String(entry.channelId ?? '').trim();
		const content = String(entry.content ?? '');
		if (!channelId) throw new NodeOperationError(node, 'Channel is required for every Channel Post');
		if (!content.trim()) throw new NodeOperationError(node, 'Content is required for every Channel Post');
		return {
			channelId,
			content,
			...(entry.firstComment ? { firstComment: entry.firstComment } : {}),
			media: validateMedia(node, parseArray<PostSiderMedia>(node, entry.mediaJson, 'Media JSON')),
			settings: parseJsonObject(node, entry.settingsJson || '{}', 'Settings JSON'),
		};
	});
	const tags = parseArray<PostSiderTag>(node, parameters.tagsJson, 'Tags JSON');
	const suppliedKey = String(parameters.idempotencyKey ?? '').trim();
	const idempotencyKey = validateIdempotencyKey(
		node,
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

function encodedId(
	node: INode,
	parameters: IDataObject,
	name: string,
	displayName: string,
): string {
	return encodeURIComponent(requiredString(node, parameters, name, displayName));
}

const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];
const POLICY_POST_TYPES = ['draft', 'schedule', 'now'];
const MAX_NOTE_LENGTH = 500;
const MAX_NAME_LENGTH = 100;
const DEFAULT_APPROVAL_LIMIT = 25;
const MAX_APPROVAL_LIMIT = 100;
export const MAX_APPROVAL_PAGES = 10;

function groupName(node: INode, parameters: IDataObject): string {
	const name = requiredString(node, parameters, 'groupName', 'Group Name');
	if (name.length > MAX_NAME_LENGTH) {
		throw new NodeOperationError(node, `Group Name must be at most ${MAX_NAME_LENGTH} characters`);
	}
	return name;
}

export function nodeToken(nodeName: unknown): string {
	return String(nodeName ?? '')
		.replace(/[^A-Za-z0-9._-]/g, '_')
		.slice(0, 40);
}

/**
 * The key is bound to the execution, the node, the item, the approval, the
 * decision, the stage position and the request time. A different stage or a
 * re-requested approval never replays an older answer, and two Approve nodes in
 * one execution never collide. Without a stage binding (the read failed) a
 * random per-call nonce replaces the digest instead of a stale deterministic key.
 */
function decisionKey(
	node: INode,
	decision: string,
	parameters: IDataObject,
	approvalId: string,
	note: string,
	executionId: string,
	itemIndex: number,
	position: number | undefined,
	requestedAt: string | undefined,
): IDataObject {
	const token = nodeToken(parameters.nodeName);
	const tail =
		position === undefined
			? `nonce-${randomUUID()}`
			: createHash('sha256')
					.update(JSON.stringify([approvalId, decision, note, position, requestedAt]))
					.digest('hex')
					.slice(0, 32);
	return {
		'Idempotency-Key': validateIdempotencyKey(
			node,
			`n8n:${executionId}:${token ? `${token}:` : ''}item:${itemIndex}:${tail}`,
		),
	};
}

export function buildDecisionRequest(
	node: INode,
	decision: 'approve' | 'reject',
	parameters: IDataObject,
	executionId: string,
	itemIndex: number,
): OperationRequest {
	const id = encodedId(node, parameters, 'approvalId', 'Approval ID');
	const note = String(parameters.note ?? '').trim();
	if (note.length > MAX_NOTE_LENGTH) {
		throw new NodeOperationError(node, `Note must be at most ${MAX_NOTE_LENGTH} characters`);
	}
	const position = parameters.stagePosition;
	const requestedAt = parameters.requestedAt;
	const bound =
		typeof position === 'number' &&
		Number.isInteger(position) &&
		position >= 1 &&
		typeof requestedAt === 'string' &&
		requestedAt !== '';
	return {
		method: 'POST',
		endpoint: `/approvals/${id}/${decision}`,
		input: {
			body: { ...(note ? { note } : {}), ...(bound ? { expectStage: position } : {}) },
			headers: decisionKey(
				node,
				decision,
				parameters,
				requiredString(node, parameters, 'approvalId', 'Approval ID'),
				note,
				executionId,
				itemIndex,
				bound ? position : undefined,
				bound ? requestedAt : undefined,
			),
		},
	};
}

/** GET /approvals/:id, used to bind a decision to the current stage and round. */
export function buildApprovalReadRequest(node: INode, parameters: IDataObject): OperationRequest {
	return {
		method: 'GET',
		endpoint: `/approvals/${encodedId(node, parameters, 'approvalId', 'Approval ID')}`,
		input: {},
	};
}

/** Stage position and requestedAt from a GET /approvals/:id response, if usable. */
export function readDecisionBinding(
	response: unknown,
): { stagePosition: number; requestedAt: string } | undefined {
	if (!response || typeof response !== 'object') return undefined;
	const item = response as { requestedAt?: unknown; stage?: { position?: unknown } | null };
	const position = item.stage?.position;
	if (
		typeof position === 'number' &&
		Number.isInteger(position) &&
		position >= 1 &&
		typeof item.requestedAt === 'string' &&
		item.requestedAt !== ''
	) {
		return { stagePosition: position, requestedAt: item.requestedAt };
	}
	return undefined;
}

function buildApprovalListRequest(node: INode, parameters: IDataObject): OperationRequest {
	const status = String(parameters.status ?? '').trim().toUpperCase();
	if (status && !APPROVAL_STATUSES.includes(status)) {
		throw new NodeOperationError(node, 'Status must be Pending, Approved or Rejected');
	}
	const since = String(parameters.since ?? '').trim();
	const returnAll = Boolean(parameters.returnAll);
	let limit = DEFAULT_APPROVAL_LIMIT;
	if (returnAll) {
		limit = MAX_APPROVAL_LIMIT;
	} else if (parameters.limit !== undefined && parameters.limit !== '') {
		limit = Number(parameters.limit);
		if (!Number.isInteger(limit) || limit < 1 || limit > MAX_APPROVAL_LIMIT) {
			throw new NodeOperationError(node, `Limit must be a whole number from 1 to ${MAX_APPROVAL_LIMIT}`);
		}
	}
	const cursor = String(parameters.cursor ?? '').trim();
	return {
		method: 'GET',
		endpoint: '/approvals',
		input: {
			qs: {
				...(status ? { status } : {}),
				...(since ? { since: normalizeScheduledDate(node, since) } : {}),
				limit,
				...(cursor ? { cursor } : {}),
			},
		},
	};
}

function buildPolicyCheckRequest(node: INode, parameters: IDataObject): OperationRequest {
	const type = String(parameters.type ?? 'draft');
	if (!POLICY_POST_TYPES.includes(type)) {
		throw new NodeOperationError(node, 'Post Type must be Draft, Schedule or Now');
	}
	const publishDate = String(parameters.publishDate ?? '').trim();
	if (type === 'schedule' && !publishDate) throw new NodeOperationError(node, 'Publish Date is required for scheduled posts');
	const collection = (parameters.channelPosts ?? {}) as ChannelPostCollection;
	const entries = collection.channelPost ?? [];
	if (entries.length === 0) throw new NodeOperationError(node, 'At least one Channel Post is required');
	if (entries.length > 20) throw new NodeOperationError(node, 'At most 20 Channel Posts can be checked at once');
	const posts = entries.map((entry) => {
		const channelId = String(entry.channelId ?? '').trim();
		if (!channelId) throw new NodeOperationError(node, 'Channel is required for every Channel Post');
		const media = validateMedia(node, parseArray<PostSiderMedia>(node, entry.mediaJson, 'Media JSON'));
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
				...(type === 'schedule' && publishDate ? { date: normalizeScheduledDate(node, publishDate) } : {}),
				posts,
			} as unknown as IDataObject,
		},
	};
}

/** Pulls the item list out of a cursor-paginated list response. */
export function extractList(response: unknown): unknown[] {
	if (Array.isArray(response)) return response;
	if (response && typeof response === 'object') {
		for (const key of ['approvals', 'policies', 'customers', 'flows', 'items', 'data', 'results']) {
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
	node: INode,
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
		return { method: 'POST', endpoint: '/customers', input: { body: { name: groupName(node, parameters) } } };
	}
	if (resource === 'group' && operation === 'update') {
		return {
			method: 'PUT',
			endpoint: `/customers/${encodedId(node, parameters, 'targetGroupId', 'Group ID')}`,
			input: { body: { name: groupName(node, parameters) } },
		};
	}
	if (resource === 'group' && operation === 'archive') {
		return {
			method: 'POST',
			endpoint: `/customers/${encodedId(node, parameters, 'targetGroupId', 'Group ID')}/archive`,
			input: {},
		};
	}
	if (resource === 'policy' && operation === 'check') return buildPolicyCheckRequest(node, parameters);
	if (resource === 'policy' && operation === 'getMany') {
		return { method: 'GET', endpoint: '/policies', input: {} };
	}
	if (resource === 'approval' && operation === 'request') {
		return {
			method: 'POST',
			endpoint: `/posts/${encodedId(node, parameters, 'postId', 'Post ID')}/request-approval`,
			input: {},
		};
	}
	if (resource === 'approval' && operation === 'getMany') return buildApprovalListRequest(node, parameters);
	if (resource === 'approval' && (operation === 'approve' || operation === 'reject')) {
		return buildDecisionRequest(node, operation, parameters, executionId, itemIndex);
	}
	if (resource === 'post' && operation === 'create') {
		return buildCreateRequest(node, parameters, executionId, itemIndex, now);
	}
	if (resource === 'post' && operation === 'get') {
		return {
			method: 'GET',
			endpoint: `/posts/${encodedId(node, parameters, 'postId', 'Post ID')}`,
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
					startDate: requiredString(node, parameters, 'startDate', 'Start Date'),
					endDate: requiredString(node, parameters, 'endDate', 'End Date'),
					...(groupId ? { customer: groupId } : {}),
				},
			},
		};
	}
	if (resource === 'scheduling' && operation === 'findNextSlot') {
		return {
			method: 'GET',
			endpoint: `/find-slot/${encodedId(node, parameters, 'channelId', 'Channel')}`,
			input: {},
		};
	}
	if (resource === 'approval' && operation === 'getStatus') {
		return {
			method: 'GET',
			endpoint: `/posts/${encodedId(node, parameters, 'postId', 'Post ID')}/approval`,
			input: {},
		};
	}
	if (resource === 'media' && operation === 'importFromUrl') {
		const value = requiredString(node, parameters, 'url', 'URL');
		let url: URL;
		try {
			url = new URL(value);
		} catch {
			throw new NodeOperationError(node, 'URL must be a valid public HTTPS URL');
		}
		if (url.protocol !== 'https:' || url.username || url.password) {
			throw new NodeOperationError(node, 'URL must be a valid public HTTPS URL');
		}
		return {
			method: 'POST',
			endpoint: '/upload-from-url',
			input: { body: { url: url.toString() } },
		};
	}
	throw new NodeOperationError(node, `Unsupported PostSider operation: ${resource}.${operation}`);
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
