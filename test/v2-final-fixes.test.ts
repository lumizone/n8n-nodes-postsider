/* eslint-disable @n8n/community-nodes/no-restricted-imports, @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import test from 'node:test';

import { NodeApiError, NodeOperationError, type IDataObject } from 'n8n-workflow';

import { buildPostRequest } from '../nodes/PostSider/v2/postOperations';
import { v2Properties } from '../nodes/PostSider/v2/descriptions';
import { executePublish, resetPublishCache, waitForResult } from '../nodes/PostSider/v2/publish';
import { newestMatching, selectNewPosts } from '../nodes/PostSiderTrigger/poll';
import { testNode } from './helpers';

const integrations = [
	{ id: 'c1', name: 'X', identifier: 'x' },
	{ id: 'c2', name: 'LI', identifier: 'linkedin' },
];

function makeCtx(params: Record<string, unknown>, responses: unknown[], executionId = 'exA') {
	const requests: Array<Record<string, any>> = [];
	const ctx = {
		getNodeParameter: (name: string, _i: number, fallback?: unknown) => params[name] ?? fallback,
		getExecutionId: () => executionId,
		getCredentials: async () => ({ apiKey: 'k', baseUrl: 'https://api.postsider.com' }),
		getNode: () => testNode,
		getWorkflowDataProxy: () => ({ $runIndex: 0 }),
		helpers: {
			httpRequestWithAuthentication: async (_c: string, options: Record<string, unknown>) => {
				requests.push(options);
				const next = responses.shift();
				if (next instanceof Error) throw next;
				return next;
			},
		},
	} as any;
	return { ctx, requests };
}

const base = { resource: 'post', operation: 'publish', channels: ['c1', 'c2'], text: 'Hi', mediaSource: 'none' };
const at = (iso: string) => () => new Date(iso);
const noSleep = async () => {};

test('1. waitForResult treats NodeApiError with httpCode 403 as a 4xx poll error', async () => {
	let calls = 0;
	const api = (async () => {
		calls++;
		throw new NodeApiError(testNode, { message: 'x' }, { httpCode: '403' });
	}) as never;
	const rows = await waitForResult(api, [{ postId: 'p1', state: 'QUEUE' }], 60, noSleep, 5000);
	assert.equal(calls, 1);
	assert.ok(rows[0].pollError);
	assert.equal(rows[0].timedOut, undefined);
});

test('1. waitForResult ignores non-integer or non-numeric http codes', async () => {
	let n = 0;
	const api = (async () => {
		if (n++ === 0) throw Object.assign(new Error('odd'), { httpCode: 'abc' });
		return { posts: [{ id: 'p1', state: 'PUBLISHED' }] };
	}) as never;
	const rows = await waitForResult(api, [{ postId: 'p1', state: 'QUEUE' }], 60, noSleep, 5000);
	assert.equal(rows[0].state, 'PUBLISHED');
});

test('2a. a retried item with a derived key reuses date and uploaded media', async () => {
	resetPublishCache();
	const params = { ...base, when: 'nextSlot', mediaSource: 'url', mediaUrls: 'https://e.com/a.png', options: {} };
	const first = makeCtx(params, [
		integrations,
		{ id: 'm1', path: 'https://cdn/m1.png' },
		{ date: '2026-11-12T08:00:00' },
		Object.assign(new Error('Bad gateway'), { statusCode: 502 }),
	]);
	await assert.rejects(() => executePublish(first.ctx, 0, {}, at('2026-11-11T10:00:00Z'), noSleep));
	const post1 = first.requests[3];
	const second = makeCtx(params, [integrations, [{ postId: 'p1', integration: 'c1' }]]);
	const rows = await executePublish(second.ctx, 0, {}, at('2026-11-11T10:05:00Z'), noSleep);
	assert.equal(second.requests.length, 2, 'only integrations and POST');
	assert.deepEqual(second.requests[1].body, post1.body);
	assert.equal(second.requests[1].headers['Idempotency-Key'], post1.headers['Idempotency-Key']);
	assert.equal(rows[0].publishDate, '2026-11-12T08:00:00.000Z');
});

test('2a. now date is reused on retry; a changed input is not', async () => {
	resetPublishCache();
	const params = { ...base, when: 'now', options: {} };
	const first = makeCtx(params, [integrations, Object.assign(new Error('x'), { statusCode: 502 })], 'exB');
	await assert.rejects(() => executePublish(first.ctx, 0, {}, at('2026-11-11T10:00:00Z'), noSleep));
	const second = makeCtx(params, [integrations, [{ postId: 'p1', integration: 'c1' }]], 'exB');
	await executePublish(second.ctx, 0, {}, at('2026-11-11T10:09:00Z'), noSleep);
	assert.deepEqual(second.requests[1].body, first.requests[1].body);
	const third = makeCtx({ ...params, text: 'Changed' }, [integrations, [{ postId: 'p1', integration: 'c1' }]], 'exB');
	await executePublish(third.ctx, 0, {}, at('2026-11-11T10:20:00Z'), noSleep);
	assert.equal(third.requests[1].body.date, '2026-11-11T10:20:00.000Z');
});

test('2a. a user-supplied key bypasses the cache', async () => {
	resetPublishCache();
	const params = { ...base, when: 'now', options: { idempotencyKey: 'mine' } };
	const first = makeCtx(params, [integrations, Object.assign(new Error('x'), { statusCode: 502 })], 'exC');
	await assert.rejects(() => executePublish(first.ctx, 0, {}, at('2026-11-11T10:00:00Z'), noSleep));
	const second = makeCtx(params, [integrations, [{ postId: 'p1', integration: 'c1' }]], 'exC');
	await executePublish(second.ctx, 0, {}, at('2026-11-11T10:09:00Z'), noSleep);
	assert.equal(second.requests[1].body.date, '2026-11-11T10:09:00.000Z');
});

test('2a. the cache holds at most 500 entries and evicts the oldest', async () => {
	resetPublishCache();
	const params = { ...base, when: 'now', options: {} };
	for (let i = 0; i < 501; i++) {
		const run = makeCtx(params, [integrations, Object.assign(new Error('x'), { statusCode: 502 })], `ev${i}`);
		await assert.rejects(() => executePublish(run.ctx, 0, {}, at('2026-11-11T10:00:00Z'), noSleep));
	}
	const oldest = makeCtx(params, [integrations, [{ postId: 'p1', integration: 'c1' }]], 'ev0');
	await executePublish(oldest.ctx, 0, {}, at('2026-11-11T11:00:00Z'), noSleep);
	assert.equal(oldest.requests[1].body.date, '2026-11-11T11:00:00.000Z', 'ev0 was evicted');
	const newest = makeCtx(params, [integrations, [{ postId: 'p1', integration: 'c1' }]], 'ev500');
	await executePublish(newest.ctx, 0, {}, at('2026-11-11T11:00:00Z'), noSleep);
	assert.equal(newest.requests[1].body.date, '2026-11-11T10:00:00.000Z', 'ev500 still cached');
});

test('2b. a derived key hitting a 409 different-request conflict returns UNKNOWN rows', async () => {
	resetPublishCache();
	const conflict = Object.assign(new Error('Idempotency-Key already used with a different request'), {
		statusCode: 409,
	});
	const { ctx } = makeCtx({ ...base, when: 'now', options: {} }, [integrations, conflict], 'exD');
	const rows = await executePublish(ctx, 0, {}, at('2026-11-11T10:00:00Z'), noSleep);
	assert.equal(rows.length, 2);
	assert.deepEqual(rows[0], {
		channelId: 'c1',
		channelName: 'X',
		state: 'UNKNOWN',
		alreadySubmitted: true,
		idempotencyKey: 'n8n:exD:PostSider:run0:item:0',
		message: 'This item was already submitted in an earlier attempt of this run. Check the post in PostSider before retrying.',
	});
	assert.equal(rows[1].channelId, 'c2');
});

test('2b. a user-supplied key or another 409 stays an error', async () => {
	resetPublishCache();
	const conflict = Object.assign(new Error('Idempotency-Key already used with a different request'), {
		statusCode: 409,
	});
	const supplied = makeCtx({ ...base, when: 'now', options: { idempotencyKey: 'mine' } }, [integrations, conflict], 'exE');
	await assert.rejects(() => executePublish(supplied.ctx, 0, {}, at('2026-11-11T10:00:00Z'), noSleep), /different request/);
	const other = Object.assign(new Error('Something else conflicts'), { statusCode: 409 });
	const derived = makeCtx({ ...base, when: 'now', options: {} }, [integrations, other], 'exF');
	await assert.rejects(() => executePublish(derived.ctx, 0, {}, at('2026-11-11T10:00:00Z'), noSleep), /Something else/);
});

test('3. getMany sends the group filter as customer', () => {
	const qs = buildPostRequest(testNode, 'getMany', { range: 'next7', groupId: 'g1' }, new Date('2026-11-11T10:00:00Z'))
		.input.qs as any;
	assert.equal(qs.customer, 'g1');
	const none = buildPostRequest(testNode, 'getMany', { range: 'next7', groupId: '' }, new Date('2026-11-11T10:00:00Z'))
		.input.qs as any;
	assert.equal('customer' in none, false);
	const filters = (v2Properties as any[]).find(
		(p) => p.name === 'filters' && JSON.stringify(p.displayOptions?.show?.operation) === '["getMany"]' && p.displayOptions.show.resource?.[0] === 'post',
	);
	const group = filters.options.find((o: any) => o.name === 'groupId');
	assert.equal(group.typeOptions.loadOptionsMethod, 'getGroups');
});

test('3. executor passes the group filter to GET /posts', async () => {
	const { executeV2 } = await import('../nodes/PostSider/v2/execute');
	const { ctx, requests } = makeCtx(
		{ resource: 'post', operation: 'getMany', range: 'next7', filters: { groupId: 'g9' }, simplify: false },
		[{ posts: [] }],
	);
	ctx.getInputData = () => [{ json: {} }];
	ctx.continueOnFail = () => false;
	ctx.helpers.returnJsonArray = (d: IDataObject[]) => d.map((json) => ({ json }));
	ctx.helpers.constructExecutionMetaData = (d: any[]) => d;
	await executeV2.call(ctx);
	assert.equal(requests[0].qs.customer, 'g9');
});

test('5. Publish with Public URLs and an empty list throws before any upload', async () => {
	resetPublishCache();
	const { ctx, requests } = makeCtx({ ...base, when: 'draft', mediaSource: 'url', mediaUrls: '  ', options: {} }, [integrations], 'exG');
	await assert.rejects(
		() => executePublish(ctx, 0, {}, at('2026-11-11T10:00:00Z'), noSleep),
		(error: any) => {
			assert.ok(error instanceof NodeOperationError);
			assert.match(error.message, /Media URLs must list at least one URL/);
			return true;
		},
	);
	assert.equal(requests.length, 1);
});

test('6. trigger output keeps error, errorCategory and errorRetryable when present', () => {
	const row = {
		id: '1',
		state: 'ERROR',
		publishDate: '2026-11-10T10:00:00.000Z',
		error: 'Token expired',
		errorCategory: 'AUTH_EXPIRED',
		errorRetryable: false,
		integration: { id: 'c1', name: 'Ch', providerIdentifier: 'x' },
	};
	const out = selectNewPosts([row], ['failed'], [], []).emit[0];
	assert.equal(out.error, 'Token expired');
	assert.equal(out.errorCategory, 'AUTH_EXPIRED');
	assert.equal(out.errorRetryable, false);
	assert.equal(out.event, 'failed');
	const manual = newestMatching([row], ['failed'], [])[0];
	assert.equal(manual.errorCategory, 'AUTH_EXPIRED');
	const plain = selectNewPosts([{ ...row, state: 'PUBLISHED', error: undefined }], ['published'], [], [])
		.emit[0];
	assert.equal('errorCategory' in plain, true);
	const none = selectNewPosts(
		[{ id: '2', state: 'PUBLISHED', publishDate: 'x', integration: { id: 'c1' } }],
		['published'],
		[],
		[],
	).emit[0];
	assert.equal('error' in none, false);
	assert.equal('errorCategory' in none, false);
});

test('7. Next Free Slot later than the wait timeout skips waiting', async () => {
	resetPublishCache();
	const params = { ...base, when: 'nextSlot', options: { waitForResult: true, waitTimeout: 60 } };
	const far = makeCtx(params, [integrations, { date: '2026-11-12T08:00:00' }, [{ postId: 'p1', integration: 'c1' }]], 'exH');
	const rows = await executePublish(far.ctx, 0, {}, at('2026-11-11T10:00:00Z'), noSleep);
	assert.equal(far.requests.length, 3, 'no poll request');
	assert.equal(rows[0].state, 'QUEUE');
	assert.equal(rows[0].waitSkipped, 'slot is later than the wait timeout');
	const near = makeCtx(
		params,
		[
			integrations,
			{ date: '2026-11-11T10:00:30' },
			[{ postId: 'p1', integration: 'c1' }],
			{ group: 'g', posts: [{ id: 'p1', state: 'PUBLISHED', releaseURL: 'u' }] },
		],
		'exI',
	);
	const done = await executePublish(near.ctx, 0, {}, at('2026-11-11T10:00:00Z'), noSleep);
	assert.equal(done[0].state, 'PUBLISHED');
	assert.equal(done[0].waitSkipped, undefined);
});

test('8. a non-array create response throws with the raw response', async () => {
	resetPublishCache();
	const raw = { message: 'x'.repeat(800) };
	const { ctx } = makeCtx({ ...base, when: 'draft', options: {} }, [integrations, raw], 'exJ');
	await assert.rejects(
		() => executePublish(ctx, 0, {}, at('2026-11-11T10:00:00Z'), noSleep),
		(error: any) => {
			assert.ok(error instanceof NodeOperationError);
			assert.match(error.message, /unexpected response/i);
			assert.ok(error.message.includes('"message":"xxx'));
			assert.ok(error.message.length < 700);
			return true;
		},
	);
});
