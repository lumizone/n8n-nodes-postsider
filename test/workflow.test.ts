/* eslint-disable @n8n/community-nodes/no-restricted-imports */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { PostSider } from '../nodes/PostSider/PostSider.node.ts';

interface MockRun {
	parameters: IDataObject;
	responses: unknown[];
	itemCount?: number;
	continueOnFail?: boolean;
}

async function executeMock(run: MockRun) {
	const requests: Array<Record<string, unknown>> = [];
	const responses = [...run.responses];
	const itemCount = run.itemCount ?? 1;
	const context = {
		getInputData: () => Array.from({ length: itemCount }, (_, item) => ({ json: { item } })),
		getNodeParameter: (name: string, _index: number, fallback?: unknown) =>
			run.parameters[name] ?? fallback,
		getExecutionId: () => 'execution_123',
		getCredentials: async () => ({
			apiKey: 'secret-test-key',
			baseUrl: 'https://api.postsider.com',
		}),
		continueOnFail: () => run.continueOnFail ?? false,
		getNode: () => ({ name: 'PostSider', type: 'n8n-nodes-postsider.postSider' }),
		helpers: {
			httpRequestWithAuthentication: async (_credential: string, options: Record<string, unknown>) => {
				requests.push(options);
				const response = responses.shift();
				if (response instanceof Error) throw response;
				return response;
			},
			returnJsonArray: (data: IDataObject | IDataObject[]) =>
				(Array.isArray(data) ? data : [data]).map((json) => ({ json })),
			constructExecutionMetaData: (
				data: INodeExecutionData[],
				metadata: { itemData: { item: number } },
			) => data.map((entry) => ({ ...entry, pairedItem: metadata.itemData })),
		},
	} as unknown as IExecuteFunctions;
	const output = await new PostSider().execute.call(context);
	return { output: output[0], requests };
}

test('workflow create draft sends one idempotent request per input item and links output items', async () => {
	const result = await executeMock({
		itemCount: 2,
		parameters: {
			resource: 'post',
			operation: 'create',
			type: 'draft',
			channelPosts: {
				channelPost: [{ channelId: 'ch_1', content: 'Hello', mediaJson: '[]', settingsJson: '{}' }],
			},
			shortLink: false,
			tagsJson: '[]',
			idempotencyKey: '',
		},
		responses: [
			[{ postId: 'post_1', integration: 'ch_1' }],
			[{ postId: 'post_2', integration: 'ch_1' }],
		],
	});
	assert.equal(result.requests.length, 2);
	assert.deepEqual(
		result.requests.map((request) => request.headers),
		[
			{ 'Idempotency-Key': 'n8n:execution_123:item:0' },
			{ 'Idempotency-Key': 'n8n:execution_123:item:1' },
		],
	);
	assert.deepEqual(
		result.output.map((item) => item.pairedItem),
		[{ item: 0 }, { item: 1 }],
	);
});

test('workflow continue on fail links the error and processes later items', async () => {
	const result = await executeMock({
		itemCount: 2,
		continueOnFail: true,
		parameters: {
			resource: 'post',
			operation: 'get',
			postId: 'post_1',
			simplify: false,
		},
		responses: [new Error('temporary failure'), { id: 'post_1', state: 'DRAFT' }],
	});
	assert.equal(result.requests.length, 2);
	assert.deepEqual(result.output[0], {
		json: { error: 'temporary failure' },
		pairedItem: { item: 0 },
	});
	assert.deepEqual(result.output[1], {
		json: { id: 'post_1', state: 'DRAFT' },
		pairedItem: { item: 1 },
	});
});


test('workflow get many returns simplified linked post items', async () => {
	const result = await executeMock({
		parameters: {
			resource: 'post',
			operation: 'getMany',
			startDate: '2026-10-01T00:00:00Z',
			endDate: '2026-10-08T00:00:00Z',
			groupId: '',
			simplify: true,
		},
		responses: [
			{
				posts: [
					{
						id: 'post_1',
						content: 'Hello',
						state: 'QUEUE',
						image: '[{"id":"media_1","path":"/a.png"}]',
						integration: { id: 'ch_1', name: 'LinkedIn', providerIdentifier: 'linkedin' },
					},
				],
			},
		],
	});
	assert.deepEqual(result.output[0].json, {
		id: 'post_1',
		content: 'Hello',
		state: 'QUEUE',
		image: [{ id: 'media_1', path: '/a.png' }],
		integrationId: 'ch_1',
		integrationName: 'LinkedIn',
		provider: 'linkedin',
	});
	assert.deepEqual(result.output[0].pairedItem, { item: 0 });
});

test('workflow approve sends one idempotent decision per item', async () => {
	const result = await executeMock({
		itemCount: 2,
		parameters: { resource: 'approval', operation: 'approve', approvalId: 'appr_1', note: 'ok' },
		responses: [{ id: 'appr_1', status: 'APPROVED' }, { id: 'appr_1', status: 'APPROVED' }],
	});
	assert.equal(result.requests.length, 2);
	assert.deepEqual(
		result.requests.map((request) => [request.method, request.url, request.body, request.headers]),
		[0, 1].map((item) => [
			'POST',
			'https://api.postsider.com/public/v1/approvals/appr_1/approve',
			{ note: 'ok' },
			{ 'Idempotency-Key': `n8n:execution_123:item:${item}` },
		]),
	);
	assert.deepEqual(result.output.map((entry) => entry.pairedItem), [{ item: 0 }, { item: 1 }]);
});

test('workflow approve reports a missing approval id as an item error', async () => {
	const result = await executeMock({
		continueOnFail: true,
		parameters: { resource: 'approval', operation: 'approve', approvalId: '' },
		responses: [],
	});
	assert.equal(result.requests.length, 0);
	assert.match(String(result.output[0].json.error), /Approval ID is required/);
});

test('workflow approval get many returns one page when Return All is off', async () => {
	const result = await executeMock({
		parameters: {
			resource: 'approval',
			operation: 'getMany',
			approvalStatus: 'PENDING',
			since: '',
			returnAll: false,
			limit: 2,
		},
		responses: [{ approvals: [{ id: 'a1' }, { id: 'a2' }], nextCursor: 'next' }],
	});
	assert.equal(result.requests.length, 1);
	assert.deepEqual(result.requests[0].qs, { status: 'PENDING', limit: 2 });
	assert.deepEqual(result.output.map((entry) => entry.json.id), ['a1', 'a2']);
});

test('workflow approval get many follows nextCursor when Return All is on', async () => {
	const result = await executeMock({
		parameters: {
			resource: 'approval',
			operation: 'getMany',
			approvalStatus: '',
			since: '',
			returnAll: true,
		},
		responses: [
			{ approvals: [{ id: 'a1' }], nextCursor: 'c1' },
			{ approvals: [{ id: 'a2' }], nextCursor: 'c2' },
			{ approvals: [{ id: 'a3' }], nextCursor: null },
		],
	});
	assert.deepEqual(result.requests.map((request) => request.qs), [
		{ limit: 100 },
		{ limit: 100, cursor: 'c1' },
		{ limit: 100, cursor: 'c2' },
	]);
	assert.deepEqual(result.output.map((entry) => entry.json.id), ['a1', 'a2', 'a3']);
});

test('workflow approval get many stops after ten pages', async () => {
	const result = await executeMock({
		parameters: { resource: 'approval', operation: 'getMany', returnAll: true },
		responses: Array.from({ length: 12 }, (_, page) => ({
			approvals: [{ id: `a${page}` }],
			nextCursor: `c${page}`,
		})),
	});
	assert.equal(result.requests.length, 10);
	assert.equal(result.output.length, 10);
});

test('workflow policy check posts a dry run and returns the verdict', async () => {
	const result = await executeMock({
		parameters: {
			resource: 'policy',
			operation: 'check',
			policyType: 'draft',
			policyChannelPosts: { channelPost: [{ channelId: 'ch_1', content: 'Hi', mediaJson: '[]' }] },
		},
		responses: [{ allowed: false, violations: [{ rule: 'r1' }] }],
	});
	assert.equal(result.requests[0].url, 'https://api.postsider.com/public/v1/policies/evaluate');
	assert.equal(result.requests[0].method, 'POST');
	assert.equal((result.requests[0].body as { type: string }).type, 'draft');
	assert.equal(result.output[0].json.allowed, false);
});

test('workflow group create and archive use the customer routes', async () => {
	const created = await executeMock({
		parameters: { resource: 'group', operation: 'create', groupName: 'Acme' },
		responses: [{ id: 'g1', name: 'Acme' }],
	});
	assert.equal(created.requests[0].url, 'https://api.postsider.com/public/v1/customers');
	assert.deepEqual(created.requests[0].body, { name: 'Acme' });
	const archived = await executeMock({
		parameters: { resource: 'group', operation: 'archive', targetGroupId: 'g1' },
		responses: [{ id: 'g1', archived: true }],
	});
	assert.equal(archived.requests[0].url, 'https://api.postsider.com/public/v1/customers/g1/archive');
	assert.equal(archived.requests[0].body, undefined);
});

test('workflow policy get many lists rules as items', async () => {
	const result = await executeMock({
		parameters: { resource: 'policy', operation: 'getMany' },
		responses: [[{ id: 'p1' }, { id: 'p2' }]],
	});
	assert.deepEqual(result.output.map((entry) => entry.json.id), ['p1', 'p2']);
});
