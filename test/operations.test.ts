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
import { testNode } from './helpers.ts';

test('channel get many maps group filter to integrations endpoint', () => {
	assert.deepEqual(
		buildOperationRequest(testNode, 'channel', 'getMany', { groupId: 'group_1' }, 'exec_1', 0),
		{
			method: 'GET',
			endpoint: '/integrations',
			input: { qs: { group: 'group_1' } },
		},
	);
});

test('group get many maps to groups endpoint', () => {
	assert.deepEqual(buildOperationRequest(testNode, 'group', 'getMany', {}, 'exec_1', 0), {
		method: 'GET',
		endpoint: '/groups',
		input: {},
	});
});

test('post create generates a retry-safe idempotency key and draft date', () => {
	const request = buildOperationRequest(
		testNode,
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
		testNode,
		'post',
		'create',
		parameters,
		'exec_123',
		2,
		() => new Date('2026-10-01T00:00:01.000Z'),
	);
	const retry = buildOperationRequest(
		testNode,
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
				testNode,
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
	assert.deepEqual(buildOperationRequest(testNode, 'post', 'get', { postId: 'post_1' }, 'e', 0), {
		method: 'GET',
		endpoint: '/posts/post_1',
		input: {},
	});
	assert.deepEqual(
		buildOperationRequest(
			testNode,
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
		buildOperationRequest(testNode, 'scheduling', 'findNextSlot', { channelId: 'ch 1' }, 'e', 0),
		{ method: 'GET', endpoint: '/find-slot/ch%201', input: {} },
	);
	assert.deepEqual(
		buildOperationRequest(testNode, 'approval', 'getStatus', { postId: 'post_1' }, 'e', 0),
		{ method: 'GET', endpoint: '/posts/post_1/approval', input: {} },
	);
	assert.deepEqual(
		buildOperationRequest(
			testNode,
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
				testNode,
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
	assert.deepEqual(buildOperationRequest(testNode, 'approval', 'request', { postId: 'post 1' }, 'e', 0), {
		method: 'POST',
		endpoint: '/posts/post%201/request-approval',
		input: {},
	});
	assert.throws(
		() => buildOperationRequest(testNode, 'approval', 'request', { postId: ' ' }, 'e', 0),
		/Post ID is required/,
	);
});

const BOUND = { stagePosition: 2, requestedAt: '2026-11-04T10:00:00.000Z', nodeName: 'Approve Post' };

function decisionKey(
	decision: string,
	extra: Record<string, unknown> = {},
	exec = 'exec_9',
	item = 3,
): string {
	const request = buildOperationRequest(
		testNode,
		'approval',
		decision,
		{ approvalId: 'appr/1', note: 'Looks good', ...BOUND, ...extra },
		exec,
		item,
	);
	return String((request.input.headers as Record<string, string>)['Idempotency-Key']);
}

test('approval approve and reject send note and expectStage with a stage bound key', () => {
	for (const decision of ['approve', 'reject']) {
		const request = buildOperationRequest(
			testNode,
			'approval',
			decision,
			{ approvalId: 'appr/1', note: '  Looks good  ', ...BOUND },
			'exec_9',
			3,
		);
		assert.equal(request.method, 'POST');
		assert.equal(request.endpoint, `/approvals/appr%2F1/${decision}`);
		assert.deepEqual(request.input.body, { note: 'Looks good', expectStage: 2 });
		const key = decisionKey(decision);
		assert.match(key, /^n8n:exec_9:Approve_Post:item:3:[0-9a-f]{32}$/);
		assert.deepEqual(request.input.headers, { 'Idempotency-Key': key });
	}
	const noNote = buildOperationRequest(testNode, 'approval', 'approve', { approvalId: 'a1', ...BOUND }, 'e', 0);
	assert.deepEqual(noNote.input.body, { expectStage: 2 });
});

test('approval decision key changes with stage, round, approval, node, item, decision and note', () => {
	const base = decisionKey('approve');
	assert.equal(base, decisionKey('approve'));
	assert.notEqual(base, decisionKey('approve', { stagePosition: 3 }));
	assert.notEqual(base, decisionKey('approve', { requestedAt: '2026-11-05T09:00:00.000Z' }));
	assert.notEqual(base, decisionKey('approve', { approvalId: 'other' }));
	assert.notEqual(base, decisionKey('approve', { nodeName: 'Approve Post 2' }));
	assert.notEqual(base, decisionKey('approve', {}, 'exec_9', 4));
	assert.notEqual(base, decisionKey('reject'));
	assert.notEqual(base, decisionKey('approve', { note: 'other' }));
});

test('two Approve nodes in one execution on different approvals never share a key', () => {
	const a = decisionKey('approve', { approvalId: 'one', nodeName: 'Approve A' }, 'exec_9', 0);
	const b = decisionKey('approve', { approvalId: 'two', nodeName: 'Approve B' }, 'exec_9', 0);
	assert.notEqual(a, b);
});

test('approval decision without a stage binding uses a random per-call key and no expectStage', () => {
	const request = () =>
		buildOperationRequest(testNode, 'approval', 'approve', { approvalId: 'a1', nodeName: 'N' }, 'exec_9', 0);
	const k1 = (request().input.headers as Record<string, string>)['Idempotency-Key'];
	const k2 = (request().input.headers as Record<string, string>)['Idempotency-Key'];
	assert.notEqual(k1, k2);
	assert.match(k1, /^n8n:exec_9:N:item:0:nonce-[0-9a-f-]+$/);
	assert.deepEqual(request().input.body, {});
});

test('approval decisions validate the id and the note length', () => {
	assert.throws(
		() => buildOperationRequest(testNode, 'approval', 'approve', { approvalId: '' }, 'e', 0),
		/Approval ID is required/,
	);
	assert.throws(
		() => buildOperationRequest(testNode, 'approval', 'reject', { approvalId: '  ' }, 'e', 0),
		/Approval ID is required/,
	);
	assert.doesNotThrow(() =>
		buildOperationRequest(testNode, 'approval', 'approve', { approvalId: 'a', note: 'x'.repeat(500) }, 'e', 0),
	);
	assert.throws(
		() =>
			buildOperationRequest(testNode, 'approval', 'approve', { approvalId: 'a', note: 'x'.repeat(501) }, 'e', 0),
		/Note must be at most 500/,
	);
	assert.throws(
		() => buildOperationRequest(testNode, 'approval', 'approve', { approvalId: 'a', ...BOUND }, 'bad exec id', 0),
		/Idempotency Key/,
	);
});

test('approval get many maps filters to the query string with a bounded limit', () => {
	assert.deepEqual(buildOperationRequest(testNode, 'approval', 'getMany', {}, 'e', 0), {
		method: 'GET',
		endpoint: '/approvals',
		input: { qs: { limit: 25 } },
	});
	assert.deepEqual(
		buildOperationRequest(
			testNode,
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
	const all = buildOperationRequest(testNode, 'approval', 'getMany', { returnAll: true, limit: 5, cursor: 'c1' }, 'e', 0);
	assert.deepEqual(all.input.qs, { limit: 100, cursor: 'c1' });
	for (const limit of [0, 101, 1.5, 'abc']) {
		assert.throws(
			() => buildOperationRequest(testNode, 'approval', 'getMany', { limit }, 'e', 0),
			/Limit must be a whole number/,
		);
	}
	assert.throws(
		() => buildOperationRequest(testNode, 'approval', 'getMany', { status: 'DONE' }, 'e', 0),
		/Status must be/,
	);
	assert.throws(
		() => buildOperationRequest(testNode, 'approval', 'getMany', { since: 'yesterday' }, 'e', 0),
		/valid ISO 8601/,
	);
});

test('list helpers read the item array and the next cursor', () => {
	assert.deepEqual(extractList([{ id: 1 }]), [{ id: 1 }]);
	assert.deepEqual(extractList({ approvals: [{ id: 2 }], nextCursor: 'n' }), [{ id: 2 }]);
	assert.deepEqual(extractList({ nothing: true }), []);
	// Real server shapes (backend controller specs).
	assert.deepEqual(
		extractList({ policies: [{ id: 'r1', name: 'No links', effect: 'BLOCK' }] }),
		[{ id: 'r1', name: 'No links', effect: 'BLOCK' }],
	);
	assert.deepEqual(extractList({ customers: [{ id: 'c1', name: 'Acme', channelCount: 2 }] }), [
		{ id: 'c1', name: 'Acme', channelCount: 2 },
	]);
	assert.deepEqual(extractList({ flows: [{ id: 'f1' }] }), [{ id: 'f1' }]);
	assert.deepEqual(extractList({ approvals: [], nextCursor: null }), []);
	assert.deepEqual(extractList(null), []);
	assert.equal(nextCursor({ nextCursor: 'n' }), 'n');
	assert.equal(nextCursor({ nextCursor: null }), undefined);
	assert.equal(nextCursor([]), undefined);
});

test('policy check builds the evaluate body from channel posts', () => {
	const request = buildOperationRequest(
		testNode,
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
		testNode,
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
		() => buildOperationRequest(testNode, 'policy', 'check', { type: 'later', channelPosts: posts }, 'e', 0),
		/Post Type must be/,
	);
	assert.throws(
		() => buildOperationRequest(testNode, 'policy', 'check', { type: 'schedule', channelPosts: posts }, 'e', 0),
		/Publish Date is required/,
	);
	assert.throws(
		() => buildOperationRequest(testNode, 'policy', 'check', { type: 'draft', channelPosts: {} }, 'e', 0),
		/At least one Channel Post/,
	);
	assert.throws(
		() =>
			buildOperationRequest(
				testNode,
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
				testNode,
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
				testNode,
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
	assert.deepEqual(buildOperationRequest(testNode, 'policy', 'getMany', {}, 'e', 0), {
		method: 'GET',
		endpoint: '/policies',
		input: {},
	});
});

test('group create, rename and archive map to the customer routes', () => {
	assert.deepEqual(buildOperationRequest(testNode, 'group', 'create', { groupName: '  Acme  ' }, 'e', 0), {
		method: 'POST',
		endpoint: '/customers',
		input: { body: { name: 'Acme' } },
	});
	assert.deepEqual(
		buildOperationRequest(testNode, 'group', 'update', { targetGroupId: 'g/1', groupName: 'New' }, 'e', 0),
		{ method: 'PUT', endpoint: '/customers/g%2F1', input: { body: { name: 'New' } } },
	);
	assert.deepEqual(buildOperationRequest(testNode, 'group', 'archive', { targetGroupId: 'g1' }, 'e', 0), {
		method: 'POST',
		endpoint: '/customers/g1/archive',
		input: {},
	});
});

test('group operations validate names and ids', () => {
	assert.throws(() => buildOperationRequest(testNode, 'group', 'create', { groupName: '   ' }, 'e', 0), /Group Name is required/);
	assert.throws(
		() => buildOperationRequest(testNode, 'group', 'create', { groupName: 'x'.repeat(101) }, 'e', 0),
		/at most 100/,
	);
	assert.doesNotThrow(() => buildOperationRequest(testNode, 'group', 'create', { groupName: 'x'.repeat(100) }, 'e', 0));
	assert.throws(
		() => buildOperationRequest(testNode, 'group', 'update', { targetGroupId: '', groupName: 'a' }, 'e', 0),
		/Group ID is required/,
	);
	assert.throws(
		() => buildOperationRequest(testNode, 'group', 'archive', { targetGroupId: ' ' }, 'e', 0),
		/Group ID is required/,
	);
});
