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
