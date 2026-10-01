/* eslint-disable @n8n/community-nodes/no-restricted-imports */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildOperationRequest,
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
	assert.throws(
		() => buildOperationRequest('approval', 'request', { postId: 'post_1' }, 'e', 0),
		/Unsupported PostSider operation/,
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
