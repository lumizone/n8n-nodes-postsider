/* eslint-disable @n8n/community-nodes/no-restricted-imports */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildOperationRequest,
	extractList,
	nextCursor,
	normalizePostResponse,
	simplifyPostResponse,
} from '../nodes/PostSider/shared/operations.ts';

test('channel get many maps group filter to integrations endpoint', () => {
	assert.deepEqual(
		buildOperationRequest('channel', 'getMany', { groupId: 'group_1' }, 'exec_1', 0),
		{
			method: 'GET',
			endpoint: '/integrations',
			input: { qs: { group: 'group_1' } },
		},
	);
});

test('group get many maps to groups endpoint', () => {
	assert.deepEqual(buildOperationRequest('group', 'getMany', {}, 'exec_1', 0), {
		method: 'GET',
		endpoint: '/groups',
		input: {},
	});
});

test('post create generates a retry-safe idempotency key and draft date', () => {
	const request = buildOperationRequest(
		'post',
		'create',
		{
			type: 'draft',
			shortLink: false,
			channelPosts: {
				channelPost: [
					{
						channelId: 'channel_1',
						content: 'Draft',
						firstComment: '',
						mediaJson: '[]',
						settingsJson: '{}',
					},
				],
			},
			tagsJson: '[]',
			idempotencyKey: '',
		},
		'exec_123',
		2,
		() => new Date('2026-10-01T12:00:00.000Z'),
	);
	assert.equal(request.method, 'POST');
	assert.equal(request.endpoint, '/posts');
	assert.deepEqual(request.input.headers, { 'Idempotency-Key': 'n8n:exec_123:item:2' });
	assert.deepEqual(request.input.body, {
		type: 'draft',
		date: '2026-10-01T00:00:00.000Z',
		shortLink: false,
		tags: [],
		creationMethod: 'API',
		posts: [
			{
				integration: { id: 'channel_1' },
				value: [{ content: 'Draft', image: [] }],
				settings: {},
			},
		],
	});
});

test('post create keeps the generated draft payload stable across same-day retries', () => {
	const parameters = {
		type: 'draft',
		shortLink: false,
		channelPosts: {
			channelPost: [
				{
					channelId: 'channel_1',
					content: 'Draft',
					mediaJson: '[]',
					settingsJson: '{}',
				},
			],
		},
		tagsJson: '[]',
		idempotencyKey: '',
	};
	const first = buildOperationRequest(
		'post',
		'create',
		parameters,
		'exec_123',
		2,
		() => new Date('2026-10-01T00:00:01.000Z'),
	);
	const retry = buildOperationRequest(
		'post',
		'create',
		parameters,
		'exec_123',
		2,
		() => new Date('2026-10-01T23:59:59.000Z'),
	);
	assert.deepEqual(retry, first);
});

test('post create requires a publish date when scheduling', () => {
	assert.throws(
		() =>
			buildOperationRequest(
				'post',
				'create',
				{
					type: 'schedule',
					publishDate: '',
					shortLink: false,
					channelPosts: { channelPost: [] },
					tagsJson: '[]',
					idempotencyKey: '',
				},
				'exec_1',
				0,
			),
		/Publish Date is required/,
	);
});

test('post read operations map IDs and date filters', () => {
	assert.deepEqual(buildOperationRequest('post', 'get', { postId: 'post_1' }, 'e', 0), {
		method: 'GET',
		endpoint: '/posts/post_1',
		input: {},
	});
	assert.deepEqual(
		buildOperationRequest(
			'post',
			'getMany',
			{
				startDate: '2026-10-01T00:00:00Z',
				endDate: '2026-10-08T00:00:00Z',
				groupId: 'group_1',
			},
			'e',
			0,
		),
		{
			method: 'GET',
			endpoint: '/posts',
			input: {
				qs: {
					startDate: '2026-10-01T00:00:00Z',
					endDate: '2026-10-08T00:00:00Z',
					customer: 'group_1',
				},
			},
		},
	);
});

test('scheduling, approval, and media operations map to bounded public endpoints', () => {
	assert.deepEqual(
		buildOperationRequest('scheduling', 'findNextSlot', { channelId: 'ch 1' }, 'e', 0),
		{ method: 'GET', endpoint: '/find-slot/ch%201', input: {} },
	);
	assert.deepEqual(
		buildOperationRequest('approval', 'getStatus', { postId: 'post_1' }, 'e', 0),
		{ method: 'GET', endpoint: '/posts/post_1/approval', input: {} },
	);
	assert.deepEqual(
		buildOperationRequest(
			'media',
			'importFromUrl',
			{ url: 'https://cdn.example/photo.png' },
			'e',
			0,
		),
		{
			method: 'POST',
			endpoint: '/upload-from-url',
			input: { body: { url: 'https://cdn.example/photo.png' } },
		},
	);
	assert.throws(
		() =>
			buildOperationRequest(
				'media',
				'importFromUrl',
				{ url: 'http://cdn.example/photo.png' },
				'e',
				0,
			),
		/public HTTPS URL/,
	);
});

test('normalizePostResponse parses media JSON strings without mutating malformed data', () => {
	assert.deepEqual(
		normalizePostResponse({
			posts: [
				{ id: 'post_1', image: '[{"id":"media_1","path":"/a.png"}]' },
				{ id: 'post_2', image: 'not-json' },
			],
		}),
		{
			posts: [
				{ id: 'post_1', image: [{ id: 'media_1', path: '/a.png' }] },
				{ id: 'post_2', image: 'not-json' },
			],
		},
	);
});

test('simplifyPostResponse keeps the operational fields and flattens integration data', () => {
	assert.deepEqual(
		simplifyPostResponse({
			id: 'post_1',
			content: 'Hello',
			publishDate: '2026-10-02T09:00:00Z',
			state: 'QUEUE',
			releaseURL: null,
			group: 'group_1',
			image: [{ id: 'm1' }],
			integration: { id: 'ch_1', name: 'PostSider', providerIdentifier: 'linkedin' },
			internal: 'drop me',
		}),
		{
			id: 'post_1',
			content: 'Hello',
			publishDate: '2026-10-02T09:00:00Z',
			state: 'QUEUE',
			releaseURL: null,
			group: 'group_1',
			image: [{ id: 'm1' }],
			integrationId: 'ch_1',
			integrationName: 'PostSider',
			provider: 'linkedin',
		},
	);
});

test('approval request posts to request-approval without a body', () => {
	assert.deepEqual(buildOperationRequest('approval', 'request', { postId: 'post 1' }, 'e', 0), {
		method: 'POST',
		endpoint: '/posts/post%201/request-approval',
		input: {},
	});
	assert.throws(
		() => buildOperationRequest('approval', 'request', { postId: ' ' }, 'e', 0),
		/Post ID is required/,
	);
});

test('approval approve and reject send the note and an execution-scoped idempotency key', () => {
	for (const decision of ['approve', 'reject']) {
		assert.deepEqual(
			buildOperationRequest(
				'approval',
				decision,
				{ approvalId: 'appr/1', note: '  Looks good  ' },
				'exec_9',
				3,
			),
			{
				method: 'POST',
				endpoint: `/approvals/appr%2F1/${decision}`,
				input: {
					body: { note: 'Looks good' },
					headers: { 'Idempotency-Key': 'n8n:exec_9:item:3' },
				},
			},
		);
	}
	const noNote = buildOperationRequest('approval', 'approve', { approvalId: 'a1' }, 'e', 0);
	assert.deepEqual(noNote.input.body, {});
});

test('approval decisions validate the id and the note length', () => {
	assert.throws(
		() => buildOperationRequest('approval', 'approve', { approvalId: '' }, 'e', 0),
		/Approval ID is required/,
	);
	assert.throws(
		() => buildOperationRequest('approval', 'reject', { approvalId: '  ' }, 'e', 0),
		/Approval ID is required/,
	);
	assert.doesNotThrow(() =>
		buildOperationRequest('approval', 'approve', { approvalId: 'a', note: 'x'.repeat(500) }, 'e', 0),
	);
	assert.throws(
		() =>
			buildOperationRequest('approval', 'approve', { approvalId: 'a', note: 'x'.repeat(501) }, 'e', 0),
		/Note must be at most 500/,
	);
	assert.throws(
		() => buildOperationRequest('approval', 'approve', { approvalId: 'a' }, 'bad exec id', 0),
		/Idempotency Key/,
	);
});

test('approval get many maps filters to the query string with a bounded limit', () => {
	assert.deepEqual(buildOperationRequest('approval', 'getMany', {}, 'e', 0), {
		method: 'GET',
		endpoint: '/approvals',
		input: { qs: { limit: 25 } },
	});
	assert.deepEqual(
		buildOperationRequest(
			'approval',
			'getMany',
			{ status: 'pending', since: '2026-11-01T00:00:00Z', limit: 10 },
			'e',
			0,
		),
		{
			method: 'GET',
			endpoint: '/approvals',
			input: { qs: { status: 'PENDING', since: '2026-11-01T00:00:00.000Z', limit: 10 } },
		},
	);
	const all = buildOperationRequest('approval', 'getMany', { returnAll: true, limit: 5, cursor: 'c1' }, 'e', 0);
	assert.deepEqual(all.input.qs, { limit: 100, cursor: 'c1' });
	for (const limit of [0, 101, 1.5, 'abc']) {
		assert.throws(
			() => buildOperationRequest('approval', 'getMany', { limit }, 'e', 0),
			/Limit must be a whole number/,
		);
	}
	assert.throws(
		() => buildOperationRequest('approval', 'getMany', { status: 'DONE' }, 'e', 0),
		/Status must be/,
	);
	assert.throws(
		() => buildOperationRequest('approval', 'getMany', { since: 'yesterday' }, 'e', 0),
		/valid ISO 8601/,
	);
});

test('list helpers read the item array and the next cursor', () => {
	assert.deepEqual(extractList([{ id: 1 }]), [{ id: 1 }]);
	assert.deepEqual(extractList({ approvals: [{ id: 2 }], nextCursor: 'n' }), [{ id: 2 }]);
	assert.deepEqual(extractList({ nothing: true }), []);
	assert.deepEqual(extractList(null), []);
	assert.equal(nextCursor({ nextCursor: 'n' }), 'n');
	assert.equal(nextCursor({ nextCursor: null }), undefined);
	assert.equal(nextCursor([]), undefined);
});

test('policy check builds the evaluate body from channel posts', () => {
	const request = buildOperationRequest(
		'policy',
		'check',
		{
			type: 'schedule',
			publishDate: '2026-11-10T09:00:00',
			channelPosts: {
				channelPost: [
					{
						channelId: 'ch_1',
						content: 'Hello',
						firstComment: 'First',
						mediaJson: '[{"id":"m1","path":"/a.png"}]',
					},
					{ channelId: 'ch_2', content: '', mediaJson: '[]' },
				],
			},
		},
		'e',
		0,
	);
	assert.deepEqual(request, {
		method: 'POST',
		endpoint: '/policies/evaluate',
		input: {
			body: {
				type: 'schedule',
				date: '2026-11-10T09:00:00.000Z',
				posts: [
					{
						integration: { id: 'ch_1' },
						value: [{ content: 'Hello', image: [{ path: '/a.png' }] }],
						firstComment: 'First',
					},
					{ integration: { id: 'ch_2' }, value: [{ content: '', image: [] }] },
				],
			},
		},
	});
	const draft = buildOperationRequest(
		'policy',
		'check',
		{ type: 'draft', channelPosts: { channelPost: [{ channelId: 'c', content: 'x' }] } },
		'e',
		0,
	);
	assert.equal('date' in (draft.input.body as object), false);
});

test('policy check validates type, date, channels and media', () => {
	const posts = { channelPost: [{ channelId: 'c', content: 'x' }] };
	assert.throws(
		() => buildOperationRequest('policy', 'check', { type: 'later', channelPosts: posts }, 'e', 0),
		/Post Type must be/,
	);
	assert.throws(
		() => buildOperationRequest('policy', 'check', { type: 'schedule', channelPosts: posts }, 'e', 0),
		/Publish Date is required/,
	);
	assert.throws(
		() => buildOperationRequest('policy', 'check', { type: 'draft', channelPosts: {} }, 'e', 0),
		/At least one Channel Post/,
	);
	assert.throws(
		() =>
			buildOperationRequest(
				'policy',
				'check',
				{ type: 'draft', channelPosts: { channelPost: [{ channelId: '', content: 'x' }] } },
				'e',
				0,
			),
		/Channel is required/,
	);
	assert.throws(
		() =>
			buildOperationRequest(
				'policy',
				'check',
				{
					type: 'draft',
					channelPosts: { channelPost: Array.from({ length: 21 }, () => ({ channelId: 'c' })) },
				},
				'e',
				0,
			),
		/At most 20/,
	);
	assert.throws(
		() =>
			buildOperationRequest(
				'policy',
				'check',
				{
					type: 'draft',
					channelPosts: { channelPost: [{ channelId: 'c', mediaJson: '[{"id":"m"}]' }] },
				},
				'e',
				0,
			),
		/non-empty id and path/,
	);
});

test('policy get many lists rules', () => {
	assert.deepEqual(buildOperationRequest('policy', 'getMany', {}, 'e', 0), {
		method: 'GET',
		endpoint: '/policies',
		input: {},
	});
});

test('group create, rename and archive map to the customer routes', () => {
	assert.deepEqual(buildOperationRequest('group', 'create', { groupName: '  Acme  ' }, 'e', 0), {
		method: 'POST',
		endpoint: '/customers',
		input: { body: { name: 'Acme' } },
	});
	assert.deepEqual(
		buildOperationRequest('group', 'update', { targetGroupId: 'g/1', groupName: 'New' }, 'e', 0),
		{ method: 'PUT', endpoint: '/customers/g%2F1', input: { body: { name: 'New' } } },
	);
	assert.deepEqual(buildOperationRequest('group', 'archive', { targetGroupId: 'g1' }, 'e', 0), {
		method: 'POST',
		endpoint: '/customers/g1/archive',
		input: {},
	});
});

test('group operations validate names and ids', () => {
	assert.throws(() => buildOperationRequest('group', 'create', { groupName: '   ' }, 'e', 0), /Group Name is required/);
	assert.throws(
		() => buildOperationRequest('group', 'create', { groupName: 'x'.repeat(101) }, 'e', 0),
		/at most 100/,
	);
	assert.doesNotThrow(() => buildOperationRequest('group', 'create', { groupName: 'x'.repeat(100) }, 'e', 0));
	assert.throws(
		() => buildOperationRequest('group', 'update', { targetGroupId: '', groupName: 'a' }, 'e', 0),
		/Group ID is required/,
	);
	assert.throws(
		() => buildOperationRequest('group', 'archive', { targetGroupId: ' ' }, 'e', 0),
		/Group ID is required/,
	);
});
