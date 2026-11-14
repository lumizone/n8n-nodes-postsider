/* eslint-disable @n8n/community-nodes/no-restricted-imports, @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import test from 'node:test';

import { NodeApiError, NodeOperationError, type JsonObject } from 'n8n-workflow';

import { PostSider } from '../nodes/PostSider/PostSider.node.ts';
import { fieldProperties } from '../nodes/PostSider/resources/descriptions';
import { buildOperationRequest } from '../nodes/PostSider/shared/operations';
import { normalizeScheduledDate } from '../nodes/PostSider/shared/payloads';
import { postSiderApiRequest } from '../nodes/PostSider/shared/transport';
import { v2Properties } from '../nodes/PostSider/v2/descriptions';
import { executeV2 } from '../nodes/PostSider/v2/execute';
import { parseUrlList } from '../nodes/PostSider/v2/inputs';
import { uploadFromUrls } from '../nodes/PostSider/v2/media';
import { buildPostRequest, shapePostOutput } from '../nodes/PostSider/v2/postOperations';
import { executePublish, resetPublishCache, resolvePublishDate, waitForResult } from '../nodes/PostSider/v2/publish';
import { makeFakeContext, testNode } from './helpers';

const BACKEND_KEY = /^[A-Za-z0-9._:-]{1,255}$/;
const SCOPE = '[0-9a-f]{12}:[0-9a-f]{12}';
const integrations = [{ id: 'c1', name: 'X', identifier: 'x' }];
const publishParams = {
	resource: 'post',
	operation: 'publish',
	channels: ['c1'],
	text: 'Hi',
	when: 'draft',
	mediaSource: 'none',
	options: {},
};
const noSleep = async () => {};

async function publishKey(ids: Record<string, unknown> = {}, run = 0): Promise<string> {
	resetPublishCache();
	const { context, requests } = makeFakeContext(
		publishParams,
		[integrations, [{ postId: 'p1', integration: 'c1' }]],
		{ nodeName: 'Publish', ...ids, runIndex: run } as any,
	);
	await executePublish(context, 0, {}, () => new Date('2026-11-11T10:00:00Z'), noSleep);
	return String(requests[1].headers['Idempotency-Key']);
}

// ---- B6: idempotency keys ----

test('B6. the derived Publish key carries instance, workflow, execution, node, run and item', async () => {
	const key = await publishKey({ executionId: 'ex42' }, 3);
	assert.match(key, new RegExp(`^n8n:${SCOPE}:ex42:Publish:run3:item:0$`));
	assert.match(key, BACKEND_KEY);
});

test('B6. another instance or another workflow gives another key; the same execution repeats it', async () => {
	const base = await publishKey({});
	assert.equal(await publishKey({}), base, 'deterministic for a retry');
	assert.notEqual(await publishKey({ instanceId: 'other-instance' }), base);
	assert.notEqual(await publishKey({ workflowId: 'other-workflow' }), base);
	assert.notEqual(await publishKey({ executionId: 'ex2' }), base);
	assert.notEqual(await publishKey({}, 1), base, 'another run');
});

test('B6. an unsafe or very long execution ID is hashed and the key stays valid', async () => {
	const long = await publishKey({ executionId: 'x'.repeat(500) });
	const odd = await publishKey({ executionId: 'run #1 / ä' });
	for (const key of [long, odd]) {
		assert.match(key, BACKEND_KEY);
		assert.match(key, new RegExp(`^n8n:${SCOPE}:[0-9a-f]{32}:Publish:run0:item:0$`));
	}
	assert.notEqual(long, odd);
});

test('B6. without an execution ID the key falls back to a random UUID and stays valid', async () => {
	const key = await publishKey({ executionId: '' });
	assert.match(key, BACKEND_KEY);
	assert.match(key, new RegExp(`^n8n:${SCOPE}:[0-9a-f-]{36}:Publish:run0:item:0$`));
});

async function createKey(ids: Record<string, unknown> = {}, run = 0): Promise<string> {
	const { context, requests } = makeFakeContext(
		{
			resource: 'post',
			operation: 'create',
			type: 'draft',
			channelPosts: { channelPost: [{ channelId: 'c1', content: 'Hi', mediaJson: '[]', settingsJson: '{}' }] },
			shortLink: false,
			tagsJson: '[]',
			idempotencyKey: '',
		},
		[[{ postId: 'p1', integration: 'c1' }]],
		{ typeVersion: 1, nodeName: 'My Node', ...ids, runIndex: run } as any,
	);
	await new PostSider().execute.call(context);
	return String(requests[0].headers['Idempotency-Key']);
}

test('B6. the version 1 Post Create key now includes node name and run index', async () => {
	const key = await createKey({ executionId: 'ex7' }, 2);
	assert.match(key, new RegExp(`^n8n:${SCOPE}:ex7:My_Node:[0-9a-f]{12}:run2:item:0$`));
	assert.match(key, BACKEND_KEY);
	assert.equal(await createKey({ executionId: 'ex7' }, 2), key);
	assert.notEqual(await createKey({ executionId: 'ex7', workflowId: 'w2' }, 2), key);
	assert.notEqual(await createKey({ executionId: 'ex7', instanceId: 'i2' }, 2), key);
});

test('B6. version 1 approval decision keys are bound to instance and workflow too', async () => {
	const decide = async (ids: Record<string, unknown>) => {
		const { context, requests } = makeFakeContext(
			{ resource: 'approval', operation: 'approve', approvalId: 'a1' },
			[{ requestedAt: '2026-11-04T10:00:00.000Z', stage: { position: 1 } }, { status: 'APPROVED' }],
			{ typeVersion: 1, ...ids } as any,
		);
		await new PostSider().execute.call(context);
		return String(requests[1].headers['Idempotency-Key']);
	};
	const key = await decide({});
	assert.match(key, new RegExp(`^n8n:${SCOPE}:ex1:PostSider:item:0:[0-9a-f]{32}$`));
	assert.equal(await decide({}), key);
	assert.notEqual(await decide({ workflowId: 'w2' }), key);
	assert.notEqual(await decide({ instanceId: 'i2' }), key);
});

// ---- B7: Post > Delete ----

test('B7. Post Delete returns postId and deleted: true', async () => {
	const { context, requests } = makeFakeContext(
		{ resource: 'post', operation: 'delete', postId: 'p1' },
		[{ id: 'group-1' }],
	);
	const out = await executeV2.call(context);
	assert.equal(requests[0].method, 'DELETE');
	assert.deepEqual(out[0].map((o) => o.json), [{ postId: 'p1', deleted: true }]);
	assert.deepEqual(shapePostOutput('delete', [{ id: 'g' }], { postId: 'p2' }), [{ postId: 'p2', deleted: true }]);
});

test('B7. the Delete operation says it deletes the post and its thread on one channel', () => {
	const operation = v2Properties.find(
		(p) => p.name === 'operation' && (p.displayOptions?.show?.resource as string[])[0] === 'post',
	);
	const del = (operation?.options as any[]).find((o) => o.value === 'delete');
	assert.equal(del.action, 'Delete post');
	assert.equal(
		del.description,
		'Delete the post and its thread on its channel. Posts on other channels from the same Publish are not deleted. This cannot be undone.',
	);
	assert.doesNotMatch(JSON.stringify(v2Properties), /every channel version|channel versions/);
});

// ---- B8: Wait for Result and 429 ----

test('B8. 429 on a poll is retried on the next round, not reported as pollError', async () => {
	let calls = 0;
	const sleeps: number[] = [];
	const api = (async () => {
		if (calls++ === 0) throw Object.assign(new Error('Too many requests'), { statusCode: 429 });
		return { posts: [{ id: 'p1', state: 'PUBLISHED' }] };
	}) as never;
	const rows = await waitForResult(api, [{ postId: 'p1', state: 'QUEUE' }], 60, async (ms) => void sleeps.push(ms), 5000);
	assert.equal(rows[0].state, 'PUBLISHED');
	assert.equal(rows[0].pollError, undefined);
	assert.deepEqual(sleeps, [5000]);
});

test('B8. a NodeApiError 429 with Retry-After waits that long', async () => {
	let calls = 0;
	const sleeps: number[] = [];
	const api = (async () => {
		if (calls++ === 0) {
			const error = new NodeApiError(testNode, { message: 'slow down' } as JsonObject, { httpCode: '429' });
			(error as any).cause = { response: { headers: { 'Retry-After': '12' } } };
			throw error;
		}
		return { posts: [{ id: 'p1', state: 'PUBLISHED' }] };
	}) as never;
	const rows = await waitForResult(api, [{ postId: 'p1', state: 'QUEUE' }], 60, async (ms) => void sleeps.push(ms), 5000);
	assert.equal(rows[0].state, 'PUBLISHED');
	assert.deepEqual(sleeps, [12000]);
});

test('B8. a Retry-After beyond the timeout ends in timedOut without sleeping or failing the row', async () => {
	const sleeps: number[] = [];
	const api = (async () => {
		throw Object.assign(new Error('Too many requests'), {
			statusCode: 429,
			response: { headers: { 'retry-after': '120' } },
		});
	}) as never;
	const rows = await waitForResult(api, [{ postId: 'p1', state: 'QUEUE' }], 60, async (ms) => void sleeps.push(ms), 5000);
	assert.equal(rows[0].timedOut, true);
	assert.equal(rows[0].pollError, undefined);
	assert.deepEqual(sleeps, []);
});

test('B8. other 4xx errors still stop the wait with pollError', async () => {
	const api = (async () => {
		throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
	}) as never;
	const rows = await waitForResult(api, [{ postId: 'p1', state: 'QUEUE' }], 60, noSleep, 5000);
	assert.equal(rows[0].pollError, 'Forbidden');
});

// ---- B9: timeouts ----

test('B9. Post Check, Post Rewrite and Channel Get Options use a 120 s timeout; others keep 30 s', async () => {
	const timeoutOf = async (params: Record<string, unknown>, response: unknown) => {
		const { context, requests } = makeFakeContext(params, [response]);
		await executeV2.call(context);
		return requests[0].timeout;
	};
	assert.equal(
		await timeoutOf({ resource: 'post', operation: 'check', text: 'Hi', platforms: ['x'] }, { ok: true }),
		120000,
	);
	assert.equal(await timeoutOf({ resource: 'post', operation: 'rewrite', text: 'Hi' }, [{ text: 'a' }]), 120000);
	assert.equal(
		await timeoutOf({ resource: 'channel', operation: 'getOptions', channelId: 'c1', tool: 'boards' }, { output: [] }),
		120000,
	);
	assert.equal(await timeoutOf({ resource: 'post', operation: 'get', postId: 'p1', simplify: false }, { posts: [] }), 30000);
	assert.equal(await timeoutOf({ resource: 'channel', operation: 'getRules', channelId: 'c1' }, {}), 30000);
});

// ---- B10: state filter ----

test('B10. the Post Get Many state filter offers approval and held posts, sorted by name', () => {
	const filters = v2Properties.find((p) => p.name === 'filters') as any;
	const state = filters.options.find((o: any) => o.name === 'state');
	const names = state.options.map((o: any) => o.name);
	assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
	const byName = Object.fromEntries(state.options.map((o: any) => [o.name, o.value]));
	assert.equal(byName['Awaiting Approval'], 'APPROVAL');
	assert.equal(byName.Held, 'HELD');
	const range = buildPostRequest(testNode, 'getMany', { range: 'next7', state: 'HELD' }, new Date('2026-11-11T00:00:00Z'));
	assert.equal((range.input.qs as any).state, 'HELD');
});

// ---- B11: no scope names in version 2 descriptions ----

test('B11. the AI operations say an AI key is needed, without HTTP codes or scopes', () => {
	const describe = (resource: string, value: string) => {
		const operation = v2Properties.find(
			(p) => p.name === 'operation' && (p.displayOptions?.show?.resource as string[])[0] === resource,
		);
		return String((operation?.options as any[]).find((o) => o.value === value).description);
	};
	assert.doesNotMatch(describe('channel', 'getOptions'), /scope|channels:write/);
	for (const value of ['check', 'rewrite']) {
		const text = describe('post', value);
		assert.doesNotMatch(text, /scope|posts:write/);
		assert.match(text, /Needs an AI key in PostSider and uses your AI quota\./);
		assert.doesNotMatch(text, /409|402/);
	}
});

// ---- B14: missing route ----

test('B14. a 404 "Cannot GET /public/v1/..." becomes a clear not offered by this server error', async () => {
	const cases: unknown[] = [
		Object.assign(new NodeApiError(testNode, { message: 'x' } as JsonObject, { httpCode: '404' }), {
			description: 'Cannot GET /public/v1/approvals',
		}),
		new NodeApiError(
			testNode,
			{ response: { status: 404, data: { message: 'Cannot POST /public/v1/policies/evaluate' } } } as JsonObject,
			{ httpCode: '404' },
		),
		Object.assign(new Error('Cannot GET /public/v1/groups'), { statusCode: 404 }),
	];
	for (const failure of cases) {
		const { context } = makeFakeContext({}, [failure]);
		await assert.rejects(
			() => postSiderApiRequest.call(context, 'GET', '/groups'),
			(error: any) => {
				assert.ok(error instanceof NodeApiError);
				assert.equal(error.message, 'This operation is not available on this PostSider server');
				assert.equal(error.description, 'The PostSider server you are connected to does not offer this feature.');
				assert.equal(error.httpCode, '404');
				return true;
			},
		);
	}
});

test('B14. other errors are not changed', async () => {
	const other404 = Object.assign(new Error('Post not found'), { statusCode: 404 });
	const server500 = Object.assign(new Error('Cannot GET /public/v1/x'), { statusCode: 500 });
	for (const failure of [other404, server500]) {
		const { context } = makeFakeContext({}, [failure]);
		await assert.rejects(() => postSiderApiRequest.call(context, 'GET', '/x'), (error: unknown) => error === failure);
	}
});

// ---- B15: item index on errors ----

const failingCall = async (failure: Error, itemCount = 2) => {
	const { context } = makeFakeContext(
		{ resource: 'post', operation: 'get', postId: 'p1' },
		[{ posts: [] }, failure],
		{ itemCount },
	);
	return executeV2.call(context).then(
		() => undefined,
		(error: unknown) => error as any,
	);
};

test('B15. an error that is already a Node error is rethrown unchanged with the item index', async () => {
	const original = new NodeApiError(testNode, { message: 'boom' } as JsonObject, { httpCode: '500' });
	const error = await failingCall(original);
	assert.equal(error, original);
	assert.equal(error.context.itemIndex, 1);
	const operation = new NodeOperationError(testNode, 'bad input');
	assert.equal(await failingCall(operation), operation);
	assert.equal(operation.context.itemIndex, 1);
});

test('B15. plain errors become NodeApiError (with a status) or NodeOperationError, with the item index', async () => {
	const withStatus = await failingCall(Object.assign(new Error('Bad gateway'), { statusCode: 502 }));
	assert.ok(withStatus instanceof NodeApiError);
	assert.equal(withStatus.context.itemIndex, 1);
	const without = await failingCall(new Error('weird'));
	assert.ok(without instanceof NodeOperationError);
	assert.equal(without.context.itemIndex, 1);
	assert.equal(without.message, 'weird');
});

test('B15. validation errors thrown before any request carry the item index', async () => {
	const { context } = makeFakeContext({ resource: 'channel', operation: 'getRules' }, []);
	const error = await executeV2.call(context).then(
		() => undefined,
		(e: unknown) => e as any,
	);
	assert.ok(error instanceof NodeOperationError);
	assert.equal(error.context.itemIndex, 0);
});

test('B15. version 1 keeps the item index on errors too', async () => {
	const { context } = makeFakeContext(
		{ resource: 'post', operation: 'get', postId: 'p1', simplify: true },
		[{ posts: [] }, Object.assign(new Error('Bad gateway'), { statusCode: 502 })],
		{ typeVersion: 1, itemCount: 2 },
	);
	const error = await new PostSider().execute.call(context).then(
		() => undefined,
		(e: unknown) => e as any,
	);
	assert.ok(error instanceof NodeApiError);
	assert.equal(error.context.itemIndex, 1);
});

test('B15. upload and provider errors are Node errors, not plain errors', async () => {
	const { context } = makeFakeContext(
		{ resource: 'media', operation: 'upload', uploadSource: 'url', uploadUrls: 'https://x.example/a.png' },
		[{ id: 'only-id' }],
	);
	const error = await executeV2.call(context).then(
		() => undefined,
		(e: unknown) => e as any,
	);
	assert.ok(error instanceof NodeOperationError);
	assert.match(error.message, /media ID and path/);
});

// ---- B16: dates ----

test('B16. normalizeScheduledDate accepts Z, +HH:MM, +HHMM, +HH and zone-less values', () => {
	const iso = (value: string) => normalizeScheduledDate(testNode, value);
	assert.equal(iso('2026-11-10T10:00:00Z'), '2026-11-10T10:00:00.000Z');
	assert.equal(iso('2026-11-10T10:00:00+02:00'), '2026-11-10T08:00:00.000Z');
	assert.equal(iso('2026-11-10T10:00:00+0200'), '2026-11-10T08:00:00.000Z');
	assert.equal(iso('2026-11-10T10:00:00+02'), '2026-11-10T08:00:00.000Z');
	assert.equal(iso('2026-11-10T10:00:00-0530'), '2026-11-10T15:30:00.000Z');
	assert.equal(iso('2026-11-10T10:00:00.250+01:00'), '2026-11-10T09:00:00.250Z');
	assert.equal(iso('2026-11-10T10:00+01:00'), '2026-11-10T09:00:00.000Z');
	assert.equal(iso('2026-11-10T10:00:00'), '2026-11-10T10:00:00.000Z', 'UTC when no zone is given');
	assert.equal(iso('2026-11-10'), '2026-11-10T00:00:00.000Z', 'the -10 of a date is not an offset');
	assert.equal(iso(' 2026-11-10T10:00:00Z '), '2026-11-10T10:00:00.000Z');
});

test('B16. the error names the field in single quotes', () => {
	assert.throws(() => normalizeScheduledDate(testNode, 'nope'), /'Publish Date' must be a valid ISO 8601/);
	assert.throws(() => normalizeScheduledDate(testNode, 'nope', 'Start Date'), /'Start Date' must be a valid ISO 8601/);
	assert.throws(() => normalizeScheduledDate(testNode, '2026-11-10T10:00:00+99:99', 'End Date'), /'End Date'/);
});

test('B16. every call site passes its own field name', () => {
	const now = new Date('2026-11-11T00:00:00Z');
	assert.throws(() => buildPostRequest(testNode, 'getMany', { range: 'custom', startDate: 'x', endDate: '2026-11-10T00:00:00' }, now), /'Start Date'/);
	assert.throws(() => buildPostRequest(testNode, 'getMany', { range: 'custom', startDate: '2026-11-10T00:00:00', endDate: 'x' }, now), /'End Date'/);
	assert.throws(() => buildPostRequest(testNode, 'update', { postId: 'p', date: 'x' }, now), /'Date'/);
	assert.throws(() => buildPostRequest(testNode, 'duplicate', { postId: 'p', date: 'x' }, now), /'Date'/);
	assert.throws(() => resolvePublishDate(testNode, 'schedule', 'x', now), /'Date'/);
	assert.throws(
		() => buildOperationRequest(testNode, 'approval', 'getMany', { since: 'x' }, 'ex1', 0),
		/'Requested Since'/,
	);
	assert.throws(
		() =>
			buildOperationRequest(
				testNode,
				'post',
				'create',
				{
					type: 'schedule',
					publishDate: 'x',
					channelPosts: { channelPost: [{ channelId: 'c', content: 'a' }] },
				},
				'ex1',
				0,
			),
		/'Publish Date'/,
	);
	assert.throws(
		() =>
			buildOperationRequest(
				testNode,
				'policy',
				'check',
				{ type: 'schedule', publishDate: 'x', channelPosts: { channelPost: [{ channelId: 'c' }] } },
				'ex1',
				0,
			),
		/'Publish Date'/,
	);
});

test('B16. version 1 Requested Since says it is read as UTC without a time zone', () => {
	const since = fieldProperties.find((p) => p.name === 'since') as any;
	assert.match(since.description, /UTC when no time zone is given/);
});

// ---- B13: media URL pre-check ----

test('B13. a media URL needs HTTPS and no credentials, and no file extension', () => {
	const accepted = [
		'https://cdn.example/a.png',
		'https://cdn.example/a.JPG',
		'https://cdn.example/a.Png?w=800',
		'https://cdn.example/photo',
		'https://cdn.example/images/12345',
		'https://cdn.example/a.png.txt',
		'https://cdn.example/a.pdf?x=a.png',
		'https://cdn.example/a.png#frag',
		'https://cdn.example/',
		'https://cdn.example/render?id=7&w=800',
	];
	for (const url of accepted) assert.deepEqual(parseUrlList(testNode, url), [url], url);
	const rejected = ['http://cdn.example/a.png', 'ftp://cdn.example/a.png', 'https://user:pw@cdn.example/a.png', 'not a url'];
	for (const url of rejected) {
		assert.throws(() => parseUrlList(testNode, url), /'Media URLs' must be public HTTPS URLs/, url);
	}
});

test('B13. the old extension rule is gone from the code', async () => {
	const mediaUrl = await import('../nodes/PostSider/shared/mediaUrl');
	assert.deepEqual(Object.keys(mediaUrl).sort(), ['assertMediaUrl', 'isPublicHttpsUrl']);
});

test('B13. Publish, Update and Media Upload send URLs without an extension and reject only non-HTTPS URLs', async () => {
	resetPublishCache();
	const publish = makeFakeContext(
		{ ...publishParams, mediaSource: 'url', mediaUrls: 'http://cdn.example/a.png' },
		[integrations],
	);
	await assert.rejects(() => executeV2.call(publish.context), /Media URLs/);
	assert.equal(publish.requests.length, 1, 'only the channel list was read');
	const update = makeFakeContext(
		{ resource: 'post', operation: 'update', postId: 'p', updateFields: { text: 'x' }, updateMediaSource: 'url', updateMediaUrls: 'ftp://cdn.example/a' },
		[],
	);
	await assert.rejects(() => executeV2.call(update.context), /Media URLs/);
	assert.equal(update.requests.length, 0);
	const upload = makeFakeContext(
		{ resource: 'media', operation: 'upload', uploadSource: 'url', uploadUrls: 'https://cdn.example/photo\nhttps://cdn.example/b.JPG?w=800' },
		[{ id: 'm1', path: 'p1' }, { id: 'm2', path: 'p2' }],
	);
	const out = await executeV2.call(upload.context);
	assert.equal(upload.requests.length, 2);
	assert.deepEqual(upload.requests.map((request) => request.body), [
		{ url: 'https://cdn.example/photo' },
		{ url: 'https://cdn.example/b.JPG?w=800' },
	]);
	assert.equal(out[0].length, 2);
});

test('B13. uploadFromUrls checks HTTPS itself and accepts a URL without an extension', async () => {
	await assert.rejects(() => uploadFromUrls(testNode, (async () => ({})) as never, ['http://cdn.example/a.jpg']), /Media URLs/);
	const calls: unknown[] = [];
	const api = (async (_m: string, _e: string, input: unknown) => {
		calls.push(input);
		return { id: 'm1', path: 'p' };
	}) as never;
	await uploadFromUrls(testNode, api, ['https://cdn.example/a.JPG', 'https://cdn.example/photo?w=800']);
	assert.equal(calls.length, 2);
});

test('B13. version 1 Import From URL accepts a URL without an extension and still needs HTTPS', () => {
	const build = (url: string) => buildOperationRequest(testNode, 'media', 'importFromUrl', { url }, 'ex1', 0);
	assert.deepEqual(build('https://cdn.example/a.png?w=800').input.body, { url: 'https://cdn.example/a.png?w=800' });
	assert.deepEqual(build('https://cdn.example/a.JPG').input.body, { url: 'https://cdn.example/a.JPG' });
	assert.deepEqual(build('https://cdn.example/photo').input.body, { url: 'https://cdn.example/photo' });
	assert.throws(() => build('http://cdn.example/a.png'), /public HTTPS URL/);
	assert.throws(() => build('https://u:p@cdn.example/a.png'), /public HTTPS URL/);
	assert.throws(() => build('nope'), /public HTTPS URL/);
});

test('continue on fail output keeps the PostSider reason as description', async () => {
	const { continueOnFailJson } = await import('../nodes/PostSider/shared/errors.ts');
	assert.deepEqual(continueOnFailJson({ message: 'Bad request - please check your parameters', description: 'Only failed posts can be retried' }), {
		error: 'Bad request - please check your parameters',
		description: 'Only failed posts can be retried',
	});
	assert.deepEqual(continueOnFailJson(new Error('plain')), { error: 'plain' });
	assert.deepEqual(continueOnFailJson({ message: 'same', description: 'same' }), { error: 'same' });
});
