/* eslint-disable @n8n/community-nodes/no-restricted-imports, @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { IDataObject } from 'n8n-workflow';

import {
	buildPublishRequest,
	defaultIdempotencyKey,
	resolvePublishDate,
	summarizeCreated,
	waitForResult,
	type PublishInput,
} from '../nodes/PostSider/v2/publish';
import { parseIdList } from '../nodes/PostSider/v2/inputs';
import { testNode } from './helpers';

const providers = { c1: 'x', c2: 'linkedin', yt: 'youtube' };

function input(overrides: Partial<PublishInput> = {}): PublishInput {
	return {
		channels: ['c1', 'c2'],
		text: 'Hello',
		when: 'now',
		media: [],
		perChannelText: {},
		platform: {},
		settingsJson: {},
		tags: [],
		shortLink: false,
		idempotencyKey: 'key-1',
		...overrides,
	};
}

const NOW = new Date('2026-11-11T10:00:00.000Z');
const body = (r: ReturnType<typeof buildPublishRequest>) => r.input.body as IDataObject;
const posts = (r: ReturnType<typeof buildPublishRequest>) =>
	body(r).posts as Array<Record<string, any>>;

test('now publishes with type now and current date', () => {
	const date = resolvePublishDate(testNode, 'now', undefined, NOW);
	assert.equal(date, '2026-11-11T10:00:00.000Z');
	const request = buildPublishRequest(testNode, input(), providers, date);
	assert.equal(request.method, 'POST');
	assert.equal(request.endpoint, '/posts');
	assert.equal(body(request).type, 'now');
	assert.equal(body(request).date, date);
	assert.deepEqual(request.input.headers, { 'Idempotency-Key': 'key-1' });
	assert.equal(posts(request).length, 2);
});

test('schedule normalizes date and requires it', () => {
	assert.equal(
		resolvePublishDate(testNode, 'schedule', '2026-12-01T09:30:00', NOW),
		'2026-12-01T09:30:00.000Z',
	);
	assert.throws(() => resolvePublishDate(testNode, 'schedule', '', NOW), /Date is required/);
	assert.throws(() => resolvePublishDate(testNode, 'schedule', 'nope', NOW), /valid ISO/);
	const request = buildPublishRequest(testNode, input({ when: 'schedule' }), providers, '2026-12-01T09:30:00.000Z');
	assert.equal(body(request).type, 'schedule');
});

test('draft sends type draft', () => {
	const request = buildPublishRequest(testNode, input({ when: 'draft' }), providers, '2026-11-11T10:00:00.000Z');
	assert.equal(body(request).type, 'draft');
});

test('nextSlot uses slot date and fails on null slot', () => {
	assert.equal(
		resolvePublishDate(testNode, 'nextSlot', undefined, NOW, { date: '2026-11-12T08:00:00' }),
		'2026-11-12T08:00:00.000Z',
	);
	assert.throws(
		() => resolvePublishDate(testNode, 'nextSlot', undefined, NOW, { date: null }),
		/PostSider returned no free slot for this channel/,
	);
	assert.throws(() => resolvePublishDate(testNode, 'nextSlot', undefined, NOW, undefined), /no free slot/);
	const request = buildPublishRequest(testNode, input({ when: 'nextSlot' }), providers, '2026-11-12T08:00:00.000Z');
	assert.equal(body(request).type, 'schedule');
	assert.equal(body(request).date, '2026-11-12T08:00:00.000Z');
});

test('per channel text overrides shared text for that channel only', () => {
	const request = buildPublishRequest(
		testNode,
		input({ perChannelText: { c2: 'LinkedIn text' } }),
		providers,
		NOW.toISOString(),
	);
	const [a, b] = posts(request);
	assert.equal(a.value[0].content, 'Hello');
	assert.equal(b.value[0].content, 'LinkedIn text');
});

test('media goes to every channel', () => {
	const media = [{ id: 'm1', path: 'https://x/m1.png' }];
	const request = buildPublishRequest(testNode, input({ media }), providers, NOW.toISOString());
	for (const post of posts(request)) assert.deepEqual(post.value[0].image, media);
});

test('firstComment and tags included', () => {
	const request = buildPublishRequest(
		testNode,
		input({ firstComment: 'First!', tags: [{ value: 't', label: 'T' }], shortLink: true }),
		providers,
		NOW.toISOString(),
	);
	assert.equal(posts(request)[0].firstComment, 'First!');
	assert.deepEqual(body(request).tags, [{ value: 't', label: 'T' }]);
	assert.equal(body(request).shortLink, true);
});

test('settings JSON applies to all channels or keyed by channel id', () => {
	const all = buildPublishRequest(testNode, input({ settingsJson: { foo: 1 } }), providers, NOW.toISOString());
	assert.equal(posts(all)[0].settings.foo, 1);
	assert.equal(posts(all)[1].settings.foo, 1);
	const keyed = buildPublishRequest(
		testNode,
		input({ settingsJson: { c1: { who_can_reply_post: 'following' } } }),
		providers,
		NOW.toISOString(),
	);
	assert.equal(posts(keyed)[0].settings.who_can_reply_post, 'following');
	assert.equal(posts(keyed)[1].settings.who_can_reply_post, undefined);
	assert.equal(posts(keyed)[1].settings.c1, undefined);
});

test('youtube needs a title of 2 characters', () => {
	assert.throws(
		() => buildPublishRequest(testNode, input({ channels: ['yt'], text: 'a' }), providers, NOW.toISOString()),
		/YouTube needs a title of 2 to 100 characters\. Set Options > Platform Settings > Title\./,
	);
	const ok = buildPublishRequest(testNode, input({ channels: ['yt'], text: 'Long enough' }), providers, NOW.toISOString());
	assert.equal(posts(ok)[0].settings.title, 'Long enough');
});

test('default idempotency key is n8n:<execution>:<node>:run<run>:item:<index>', () => {
	assert.equal(defaultIdempotencyKey(testNode, '', 'e42', 3), 'n8n:e42:PostSider:run0:item:3');
	assert.equal(defaultIdempotencyKey(testNode, 'mine', 'e42', 3), 'mine');
	const other = { ...testNode, name: 'Publish #2 (b)' };
	const keys = new Set([
		defaultIdempotencyKey(testNode, '', 'e42', 3, 0),
		defaultIdempotencyKey(testNode, '', 'e42', 3, 1),
		defaultIdempotencyKey(other, '', 'e42', 3, 0),
	]);
	assert.equal(keys.size, 3);
	assert.equal(defaultIdempotencyKey(other, '', 'e42', 3, 1), 'n8n:e42:Publish__2__b_:run1:item:3');
	assert.throws(() => defaultIdempotencyKey(testNode, 'bad key!', 'e42', 3), /Idempotency Key/);
});

test('channels from comma string and JSON array', () => {
	assert.deepEqual(parseIdList(testNode, 'c1, c2', 'Channels'), ['c1', 'c2']);
	assert.deepEqual(parseIdList(testNode, '["c1","c2"]', 'Channels'), ['c1', 'c2']);
});

test('summarizeCreated maps the create response', () => {
	const rows = summarizeCreated(
		[
			{ postId: 'p1', integration: 'c1', approvalRequested: false, policy: { effect: 'ALLOW', matched: [] } },
			{ postId: 'p2', integration: 'c2' },
		],
		{ c1: 'X main', c2: 'LI' },
		'QUEUE',
		'2026-11-11T10:00:00.000Z',
	);
	assert.equal(rows[0].postId, 'p1');
	assert.equal(rows[0].channelId, 'c1');
	assert.equal(rows[0].channelName, 'X main');
	assert.equal(rows[0].state, 'QUEUE');
	assert.equal(rows[0].publishDate, '2026-11-11T10:00:00.000Z');
	assert.equal(rows[0].approvalRequested, false);
	assert.deepEqual(rows[0].policy, { effect: 'ALLOW', matched: [] });
	assert.equal(rows[1].policy, null);
	assert.equal(rows[1].approvalRequested, false);
	const approval = summarizeCreated([{ postId: 'p3', integration: 'c1', approvalRequested: true }], {}, 'QUEUE', '');
	assert.equal(approval[0].state, 'DRAFT');
});

function fakeApi(states: Record<string, Array<Record<string, unknown>>>) {
	const calls: string[] = [];
	const api = (async (_method: string, endpoint: string) => {
		calls.push(endpoint);
		const id = decodeURIComponent(endpoint.replace('/posts/', ''));
		const next = states[id].length > 1 ? states[id].shift()! : states[id][0];
		return { group: 'g1', posts: [{ id, ...next }] };
	}) as never;
	return { api, calls };
}

const rowsFor = (...ids: string[]): IDataObject[] =>
	ids.map((postId) => ({ postId, channelId: 'c', state: 'QUEUE' }));

test('waitForResult returns PUBLISHED with releaseURL after two polls', async () => {
	const { api, calls } = fakeApi({ p1: [{ state: 'QUEUE' }, { state: 'PUBLISHED', releaseURL: 'https://x/1' }] });
	let sleeps = 0;
	const rows = await waitForResult(api, rowsFor('p1'), 60, async () => { sleeps++; }, 5000);
	assert.equal(rows[0].state, 'PUBLISHED');
	assert.equal(rows[0].releaseURL, 'https://x/1');
	assert.equal(rows[0].group, 'g1');
	assert.equal(calls.length, 2);
	assert.equal(sleeps, 1);
	assert.equal(rows[0].timedOut, undefined);
});

test('waitForResult keeps ERROR row with error text and does not throw', async () => {
	const { api } = fakeApi({ p1: [{ state: 'ERROR', error: 'Token expired' }], p2: [{ state: 'PUBLISHED', releaseURL: 'u' }] });
	const rows = await waitForResult(api, rowsFor('p1', 'p2'), 60, async () => {}, 5000);
	assert.equal(rows[0].state, 'ERROR');
	assert.equal(rows[0].error, 'Token expired');
	assert.equal(rows[1].state, 'PUBLISHED');
});

test('waitForResult timeout marks timedOut', async () => {
	const { api } = fakeApi({ p1: [{ state: 'QUEUE' }] });
	let sleeps = 0;
	const rows = await waitForResult(api, rowsFor('p1'), 12, async () => { sleeps++; }, 5000);
	assert.equal(rows[0].state, 'QUEUE');
	assert.equal(rows[0].timedOut, true);
	assert.equal(sleeps, 2);
});

test('executor publishes per item, fetches integrations once and wraps unknown channel errors', async () => {
	const { executeV2 } = await import('../nodes/PostSider/v2/execute');
	const requests: Array<Record<string, any>> = [];
	const run = async (channels: string[], continueOnFail = false) => {
		requests.length = 0;
		const responses: unknown[] = [
			[{ id: 'c1', name: 'X main', identifier: 'x' }],
			[{ postId: 'p1', integration: 'c1' }],
			[{ postId: 'p2', integration: 'c1' }],
		];
		const params: Record<string, unknown> = {
			resource: 'post', operation: 'publish', channels, text: 'Hi', when: 'draft', mediaSource: 'none', options: {},
		};
		const context = {
			getInputData: () => [{ json: {} }, { json: {} }],
			getNodeParameter: (name: string, _i: number, fallback?: unknown) => params[name] ?? fallback,
			getExecutionId: () => 'ex1',
			getCredentials: async () => ({ apiKey: 'k', baseUrl: 'https://api.postsider.com' }),
			continueOnFail: () => continueOnFail,
			getNode: () => testNode,
			helpers: {
				httpRequestWithAuthentication: async (_c: string, options: Record<string, unknown>) => {
					requests.push(options);
					return responses.shift();
				},
				returnJsonArray: (d: IDataObject | IDataObject[]) => (Array.isArray(d) ? d : [d]).map((json) => ({ json })),
				constructExecutionMetaData: (d: any[], m: any) => d.map((e) => ({ ...e, pairedItem: m.itemData })),
			},
		} as any;
		return executeV2.call(context);
	};
	const ok = await run(['c1']);
	assert.equal(ok[0].length, 2);
	assert.equal(requests.filter((r) => String(r.url).endsWith('/integrations')).length, 1);
	assert.equal((requests[1].headers as any)['Idempotency-Key'], 'n8n:ex1:PostSider:run0:item:0');
	assert.equal((requests[2].headers as any)['Idempotency-Key'], 'n8n:ex1:PostSider:run0:item:1');
	assert.equal(ok[0][0].json.state, 'DRAFT');
	await assert.rejects(() => run(['nope']), /Channel nope is not connected to this PostSider workspace/);
	const soft = await run(['nope'], true);
	assert.equal(soft[0].length, 2);
	assert.match(String(soft[0][0].json.error), /not connected/);
});

test('youtube title longer than 100 characters is rejected', () => {
	assert.throws(
		() =>
			buildPublishRequest(
				testNode,
				input({ channels: ['yt'], text: 'x', platform: { title: 'y'.repeat(101) } }),
				providers,
				NOW.toISOString(),
			),
		/YouTube needs a title of 2 to 100 characters/,
	);
});

test('settings JSON keyed form: unselected channel keys ignored, mixed shape fails', () => {
	const request = buildPublishRequest(
		testNode,
		input({ channels: ['c1'], settingsJson: { c1: { a: 1 }, yt: { b: 2 } } }),
		providers,
		NOW.toISOString(),
	);
	assert.equal(posts(request)[0].settings.a, 1);
	assert.equal(posts(request)[0].settings.yt, undefined);
	assert.throws(
		() =>
			buildPublishRequest(testNode, input({ settingsJson: { c1: { a: 1 }, other: 5 } }), providers, NOW.toISOString()),
		/mixes channel IDs with other keys/,
	);
});

test('waitForResult stops on DRAFT, APPROVAL and HELD', async () => {
	const { api, calls } = fakeApi({ p1: [{ state: 'HELD' }], p2: [{ state: 'APPROVAL' }], p3: [{ state: 'DRAFT' }] });
	const rows = await waitForResult(api, rowsFor('p1', 'p2', 'p3'), 60, async () => { throw new Error('no sleep'); }, 5000);
	assert.equal(calls.length, 3);
	assert.deepEqual(rows.map((r) => r.state), ['HELD', 'APPROVAL', 'DRAFT']);
});

test('waitForResult surfaces 4xx poll errors and keeps retrying 5xx', async () => {
	const fourxx = (async () => {
		throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
	}) as never;
	const rows = await waitForResult(fourxx, rowsFor('p1'), 60, async () => {}, 5000);
	assert.equal(rows[0].pollError, 'Forbidden');
	let n = 0;
	const flaky = (async () => {
		if (n++ === 0) throw Object.assign(new Error('Bad gateway'), { statusCode: 502 });
		return { group: 'g', posts: [{ id: 'p1', state: 'PUBLISHED' }] };
	}) as never;
	const ok = await waitForResult(flaky, rowsFor('p1'), 60, async () => {}, 5000);
	assert.equal(ok[0].state, 'PUBLISHED');
	assert.equal(ok[0].pollError, undefined);
});

test('waitForResult clamps timeout to 1..300 seconds', async () => {
	const { api } = fakeApi({ p1: [{ state: 'QUEUE' }] });
	let sleeps = 0;
	await waitForResult(api, rowsFor('p1'), 100000, async () => { sleeps++; }, 5000);
	assert.equal(sleeps, 60);
	sleeps = 0;
	await waitForResult(api, rowsFor('p1'), 0, async () => { sleeps++; }, 500);
	assert.equal(sleeps, 2);
});

async function runExecutor(
	params: Record<string, unknown>,
	responses: unknown[],
): Promise<{ output: any[]; requests: Array<Record<string, any>> }> {
	const { executeV2 } = await import('../nodes/PostSider/v2/execute');
	const requests: Array<Record<string, any>> = [];
	const context = {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name: string, _i: number, fallback?: unknown) => params[name] ?? fallback,
		getExecutionId: () => 'ex1',
		getCredentials: async () => ({ apiKey: 'k', baseUrl: 'https://api.postsider.com' }),
		continueOnFail: () => false,
		getNode: () => testNode,
		helpers: {
			httpRequestWithAuthentication: async (_c: string, options: Record<string, unknown>) => {
				requests.push(options);
				return responses.shift();
			},
			returnJsonArray: (d: IDataObject | IDataObject[]) => (Array.isArray(d) ? d : [d]).map((json) => ({ json })),
			constructExecutionMetaData: (d: any[], m: any) => d.map((e) => ({ ...e, pairedItem: m.itemData })),
		},
	} as any;
	try {
		const out = await executeV2.call(context);
		return { output: out[0], requests };
	} catch (error) {
		throw Object.assign(new Error((error as Error).message), { requests });
	}
}

const baseParams = {
	resource: 'post', operation: 'publish', channels: ['c1', 'c2'], text: 'Hi', mediaSource: 'none',
};
const integrations = [
	{ id: 'c1', name: 'X', identifier: 'x' },
	{ id: 'c2', name: 'LI', identifier: 'linkedin' },
];

test('executor nextSlot looks up the first channel slot before the POST and sends it as UTC', async () => {
	const { output, requests } = await runExecutor(
		{ ...baseParams, when: 'nextSlot', options: {} },
		[integrations, { date: '2026-11-12T08:00:00' }, [{ postId: 'p1', integration: 'c1' }]],
	);
	assert.match(String(requests[1].url), /\/find-slot\/c1$/);
	assert.equal(requests[2].method, 'POST');
	assert.equal(requests[2].body.date, '2026-11-12T08:00:00.000Z');
	assert.equal(requests[2].body.type, 'schedule');
	assert.equal(output[0].json.publishDate, '2026-11-12T08:00:00.000Z');
});

test('executor does not poll for draft or schedule even with waitForResult', async () => {
	for (const when of ['draft', 'schedule']) {
		const { requests } = await runExecutor(
			{ ...baseParams, when, date: '2099-01-01T00:00:00', options: { waitForResult: true } },
			[integrations, [{ postId: 'p1', integration: 'c1' }]],
		);
		assert.equal(requests.filter((r) => /\/posts\/p1/.test(String(r.url))).length, 0);
		assert.equal(requests.length, 2);
	}
});

test('invalid settings JSON makes no API call besides GET /integrations, even with url media', async () => {
	await assert.rejects(
		() =>
			runExecutor(
				{ ...baseParams, when: 'nextSlot', mediaSource: 'url', mediaUrls: 'https://e.com/a.png', options: { settingsJson: '{nope' } },
				[integrations],
			),
		(error: any) => {
			assert.match(error.message, /Settings JSON/);
			assert.equal(error.requests.length, 1);
			assert.match(String(error.requests[0].url), /\/integrations$/);
			return true;
		},
	);
	await assert.rejects(
		() =>
			runExecutor(
				{ ...baseParams, channels: ['c1'], when: 'draft', mediaSource: 'url', mediaUrls: 'https://e.com/a.png', options: { settingsJson: '{"c1":{},"zzz":1}' } },
				[integrations],
			),
		(error: any) => error.requests.length === 1,
	);
});
