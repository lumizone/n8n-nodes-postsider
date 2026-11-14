/* eslint-disable @n8n/community-nodes/no-restricted-imports, @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import test from 'node:test';

import { NodeApiError } from 'n8n-workflow';

import { httpStatusOf, serverDetailOf, withServerMessage } from '../nodes/PostSider/shared/errors.ts';
import { nodeToken, validateIdempotencyKey } from '../nodes/PostSider/shared/operations.ts';
import { normalizeScheduledDate } from '../nodes/PostSider/shared/payloads.ts';
import {
	postSiderApiRequest,
	RATE_LIMIT_DEFAULT_WAIT_MS,
	RATE_LIMIT_MAX_WAIT_MS,
	transportClock,
} from '../nodes/PostSider/shared/transport.ts';
import { makeFakeContext, testNode } from './helpers.ts';

// ---- node token ----

test('nodeToken keeps a short safe name and tells similar names apart', () => {
	assert.equal(nodeToken('Publish'), 'Publish');
	assert.equal(nodeToken('Post_Sider-2.0'), 'Post_Sider-2.0');
	assert.equal(nodeToken(''), '');
	const a = nodeToken('Publish (EN)');
	const b = nodeToken('Publish [EN]');
	assert.notEqual(a, b);
	assert.match(a, /^Publish__EN_:[0-9a-f]{12}$/);
	assert.equal(nodeToken('Publish (EN)'), a, 'stable');
});

test('nodeToken tells apart names that share their first 40 characters', () => {
	const prefix = 'x'.repeat(40);
	assert.notEqual(nodeToken(`${prefix}A`), nodeToken(`${prefix}B`));
	assert.notEqual(nodeToken(`${prefix}A`), prefix);
});

test('a hashed token never equals the token of another name, and keys stay valid', () => {
	// a hashed token contains ':' and a safe name cannot, so they cannot meet
	assert.ok(nodeToken('Publish (EN)').includes(':'));
	assert.ok(!nodeToken('Publish_EN_').includes(':'));
	for (const name of ['Publish (EN)', 'ä'.repeat(200), 'a b', '日本語']) {
		const key = `n8n:aaaaaaaaaaaa:bbbbbbbbbbbb:${'x'.repeat(64)}:${nodeToken(name)}:run10:item:100`;
		assert.doesNotThrow(() => validateIdempotencyKey(testNode, key), name);
		assert.ok(key.length <= 255);
	}
});

// ---- http status ----

test('httpStatusOf reads statusCode or httpCode, and null or empty is not a status', () => {
	assert.equal(httpStatusOf({ statusCode: 404 }), 404);
	assert.equal(httpStatusOf({ httpCode: '429' }), 429);
	assert.equal(httpStatusOf({ statusCode: null }), undefined);
	assert.equal(httpStatusOf({ statusCode: '' }), undefined);
	assert.equal(httpStatusOf({ httpCode: '  ' }), undefined);
	assert.equal(httpStatusOf({ statusCode: undefined, httpCode: null }), undefined);
	assert.equal(httpStatusOf({}), undefined);
	assert.equal(httpStatusOf(undefined), undefined);
	assert.equal(httpStatusOf({ statusCode: 'abc' }), undefined);
});

// ---- dates ----

const date = (value: string, zone?: string) => normalizeScheduledDate(testNode, value, 'Publish Date', zone);

test('dates: ISO 8601 forms are accepted', () => {
	assert.equal(date('2026-11-14'), '2026-11-14T00:00:00.000Z');
	assert.equal(date('2026-11-14T10:00'), '2026-11-14T10:00:00.000Z');
	assert.equal(date('2026-11-14 10:00:30'), '2026-11-14T10:00:30.000Z');
	assert.equal(date('2026-11-14T10:00:30.5'), '2026-11-14T10:00:30.500Z');
	assert.equal(date('2026-11-14T10:00:30.123456Z'), '2026-11-14T10:00:30.123Z');
	assert.equal(date('2026-11-14T10:00:00+01'), '2026-11-14T09:00:00.000Z');
	assert.equal(date('2026-11-14T10:00:00+0130'), '2026-11-14T08:30:00.000Z');
	assert.equal(date('2026-11-14T10:00:00-05:00'), '2026-11-14T15:00:00.000Z');
	assert.equal(date('2026-11-14T10:00:00z'), '2026-11-14T10:00:00.000Z');
	assert.equal(date(' 2026-11-14T10:00:00Z '), '2026-11-14T10:00:00.000Z');
});

test('dates: anything else and impossible dates are refused with the field name', () => {
	for (const bad of [
		'Sat Nov 14 2026 10:00:00 GMT+0100',
		'11/14/2026',
		'tomorrow',
		'',
		'2026-02-30',
		'2026-13-01',
		'2026-00-10',
		'2026-11-14T24:00:00',
		'2026-11-14T10:60:00',
		'2026-11-14T10:00:60',
		'2026-11-14T10:00:00+24:00',
		'2026-11-14T10:00:00+01:60',
		'2026-11-14T10',
		'1700000000000',
		'2026-11-14-05',
	]) {
		assert.throws(() => date(bad), /'Publish Date' must be a valid ISO 8601 date and time/, bad);
	}
	assert.equal(date('2028-02-29'), '2028-02-29T00:00:00.000Z', 'leap day');
	assert.throws(() => date('2027-02-29'));
});

test('dates: a value without a time zone is read in the given zone, others are unchanged', () => {
	assert.equal(date('2026-07-01T10:00:00', 'Europe/Warsaw'), '2026-07-01T08:00:00.000Z');
	assert.equal(date('2026-01-01T10:00:00', 'Europe/Warsaw'), '2026-01-01T09:00:00.000Z');
	assert.equal(date('2026-07-01T10:00:00', 'America/New_York'), '2026-07-01T14:00:00.000Z');
	assert.equal(date('2026-07-01', 'Asia/Tokyo'), '2026-06-30T15:00:00.000Z');
	assert.equal(date('2026-07-01T10:00:00Z', 'Europe/Warsaw'), '2026-07-01T10:00:00.000Z');
	assert.equal(date('2026-07-01T10:00:00+05:00', 'Europe/Warsaw'), '2026-07-01T05:00:00.000Z');
	assert.equal(date('2026-07-01T10:00:00', 'UTC'), '2026-07-01T10:00:00.000Z');
	assert.equal(date('2026-07-01T10:00:00', 'Not/AZone'), '2026-07-01T10:00:00.000Z', 'unknown zone reads as UTC');
});

// ---- 429 in the transport ----

function rateLimited(retryAfter?: string) {
	return Object.assign(new Error('Too Many Requests'), {
		statusCode: 429,
		...(retryAfter === undefined ? {} : { response: { headers: { 'retry-after': retryAfter } } }),
	});
}

async function withFakeClock<T>(fn: (waits: number[]) => Promise<T>): Promise<T> {
	const waits: number[] = [];
	const original = transportClock.sleep;
	transportClock.sleep = async (ms: number) => {
		waits.push(ms);
	};
	try {
		return await fn(waits);
	} finally {
		transportClock.sleep = original;
	}
}

test('429: a GET waits for Retry-After and is repeated, at most three times', async () => {
	await withFakeClock(async (waits) => {
		const { context, requests } = makeFakeContext({}, [rateLimited('7'), rateLimited(), { ok: true }]);
		const result = await postSiderApiRequest.call(context, 'GET', '/integrations');
		assert.deepEqual(result, { ok: true });
		assert.equal(requests.length, 3);
		assert.deepEqual(waits, [7000, RATE_LIMIT_DEFAULT_WAIT_MS]);
	});
	await withFakeClock(async (waits) => {
		const { context, requests } = makeFakeContext({}, [rateLimited('1'), rateLimited('1'), rateLimited('1'), rateLimited('1'), { ok: true }]);
		await assert.rejects(() => postSiderApiRequest.call(context, 'GET', '/posts'), (error: any) => httpStatusOf(error) === 429);
		assert.equal(requests.length, 4, 'one request and three retries');
		assert.deepEqual(waits, [1000, 1000, 1000]);
	});
});

test('429: each wait is capped at 60 seconds', async () => {
	await withFakeClock(async (waits) => {
		const { context } = makeFakeContext({}, [rateLimited('3600'), { ok: true }]);
		await postSiderApiRequest.call(context, 'GET', '/posts');
		assert.deepEqual(waits, [RATE_LIMIT_MAX_WAIT_MS]);
	});
});

test('429: POST /posts with an Idempotency-Key is repeated; other writes are not', async () => {
	await withFakeClock(async (waits) => {
		const { context, requests } = makeFakeContext({}, [rateLimited('2'), [{ postId: 'p1' }]]);
		await postSiderApiRequest.call(context, 'POST', '/posts', { body: {}, headers: { 'Idempotency-Key': 'k' } });
		assert.equal(requests.length, 2);
		assert.deepEqual(waits, [2000]);
	});
	await withFakeClock(async (waits) => {
		for (const [method, endpoint, headers] of [
			['POST', '/posts', undefined],
			['POST', '/upload-base64', undefined],
			['POST', '/approvals/a/approve', { 'Idempotency-Key': 'k' }],
			['PUT', '/posts/p1', undefined],
			['DELETE', '/posts/p1', undefined],
		] as const) {
			const { context, requests } = makeFakeContext({}, [rateLimited('1'), { ok: true }]);
			await assert.rejects(() => postSiderApiRequest.call(context, method, endpoint, { body: {}, headers }), (e: any) => httpStatusOf(e) === 429);
			assert.equal(requests.length, 1, `${method} ${endpoint}`);
		}
		assert.deepEqual(waits, []);
	});
});

test('429: a caller that waits itself can switch the retry off', async () => {
	await withFakeClock(async (waits) => {
		const { context, requests } = makeFakeContext({}, [rateLimited('1'), { ok: true }]);
		await assert.rejects(() => postSiderApiRequest.call(context, 'GET', '/posts/p1', { rateLimitRetry: false }));
		assert.equal(requests.length, 1);
		assert.deepEqual(waits, []);
	});
});

// ---- error details ----

test('error details: name and message of a post validation error become the description', () => {
	const error = Object.assign(new Error('Bad Request'), {
		statusCode: 400,
		context: { data: { statusCode: 400, provider: 'x', name: 'PostTooLong', message: 'The text has 300 characters; X allows 280' } },
	});
	assert.equal(serverDetailOf(error)?.description, 'PostTooLong: The text has 300 characters; X allows 280');
	const wrapped = withServerMessage(testNode, error)!;
	assert.ok(wrapped instanceof NodeApiError);
	assert.equal(wrapped.description, 'PostTooLong: The text has 300 characters; X allows 280');
});

test('error details: msg still wins, and a body with only message or only name is not used', () => {
	assert.equal(serverDetailOf({ statusCode: 400, context: { data: { msg: 'Bad thing', name: 'N', message: 'M' } } })?.description, 'Bad thing');
	assert.equal(serverDetailOf({ statusCode: 400, context: { data: { message: 'Nest text' } } }), undefined);
	assert.equal(serverDetailOf({ statusCode: 400, context: { data: { name: 'Only' } } }), undefined);
});

test('error details: 423 publishing_paused gets its own message and the reason', () => {
	const paused = Object.assign(new Error('Locked'), {
		statusCode: 423,
		context: { data: { error: 'publishing_paused', reason: 'Incident on 14 Nov' } },
	});
	const wrapped = withServerMessage(testNode, paused)!;
	assert.equal(wrapped.message, 'Publishing is paused in PostSider');
	assert.equal(wrapped.description, 'Incident on 14 Nov');
	const noReason = Object.assign(new Error('Locked'), { statusCode: 423, context: { data: { error: 'publishing_paused' } } });
	assert.equal(withServerMessage(testNode, noReason)!.description, 'Resume publishing in the PostSider dashboard.');
	// the same through a NodeApiError and a JSON string body
	const api = new NodeApiError(testNode, { message: 'Locked' } as any, { httpCode: '423' });
	(api as any).error = JSON.stringify({ error: 'publishing_paused', reason: 'R' });
	assert.equal(withServerMessage(testNode, api)!.description, 'R');
});

test('upload-from-url requests use the long timeout', async () => {
	const { PostSider } = await import('../nodes/PostSider/PostSider.node.ts');
	const { context, requests } = makeFakeContext({ resource: 'media', operation: 'importFromUrl', url: 'https://cdn.example/a.png' }, [{ id: 'm1', path: 'p' }], { typeVersion: 1 });
	await new PostSider().execute.call(context);
	assert.equal(requests[0].timeout, 120000);
	const v2 = makeFakeContext({ resource: 'media', operation: 'upload', uploadSource: 'url', uploadUrls: 'https://cdn.example/a.png' }, [{ id: 'm1', path: 'p' }]);
	const { executeV2 } = await import('../nodes/PostSider/v2/execute.ts');
	await executeV2.call(v2.context);
	assert.equal(v2.requests[0].timeout, 120000);
});
