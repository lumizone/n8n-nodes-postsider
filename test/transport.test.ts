/* eslint-disable @n8n/community-nodes/no-restricted-imports, @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import test from 'node:test';

import { NodeApiError, type JsonObject } from 'n8n-workflow';

import {
	MISSING_ROUTE_DESCRIPTION,
	MISSING_ROUTE_MESSAGE,
	httpStatusOf,
	retryAfterMsOf,
	serverMessageOf,
} from '../nodes/PostSider/shared/errors.ts';
import {
	buildRequestOptions,
	normalizeApiBaseUrl,
	postSiderApiRequest,
} from '../nodes/PostSider/shared/transport.ts';
import { makeFakeContext, testNode } from './helpers.ts';

test('normalizeApiBaseUrl accepts HTTPS and local HTTP without duplicating public API path', () => {
	assert.equal(normalizeApiBaseUrl(testNode, 'https://api.postsider.com/'), 'https://api.postsider.com/public/v1');
	assert.equal(
		normalizeApiBaseUrl(testNode, 'https://social.example.com/api/public/v1/'),
		'https://social.example.com/api/public/v1',
	);
	assert.equal(
		normalizeApiBaseUrl(testNode, 'http://localhost:3000/api'),
		'http://localhost:3000/api/public/v1',
	);
});

test('normalizeApiBaseUrl rejects insecure remote URLs and embedded credentials', () => {
	assert.throws(() => normalizeApiBaseUrl(testNode, 'http://example.com/api'), /must use HTTPS/);
	assert.throws(() => normalizeApiBaseUrl(testNode, 'https://user:pass@example.com/api'), /must not include credentials/);
});

test('buildRequestOptions refuses redirects and omits body for GET requests', () => {
	assert.deepEqual(buildRequestOptions('GET', 'https://api.postsider.com/public/v1/groups'), {
		method: 'GET',
		url: 'https://api.postsider.com/public/v1/groups',
		json: true,
		timeout: 30000,
		disableFollowRedirect: true,
		sendCredentialsOnCrossOriginRedirect: false,
	});
});

const requestIdentifier = ['n8n', 'execution_1', 'item_0'].join('.');

test('buildRequestOptions includes JSON body, query string, and explicit headers', () => {
	const body = { url: 'https://cdn.example/photo.png' };
	assert.deepEqual(
		buildRequestOptions('POST', 'https://api.postsider.com/public/v1/upload-from-url', {
			body,
			qs: { group: 'group_1' },
			headers: { 'Idempotency-Key': requestIdentifier },
		}),
		{
			method: 'POST',
			url: 'https://api.postsider.com/public/v1/upload-from-url',
			body,
			qs: { group: 'group_1' },
			headers: { 'Idempotency-Key': requestIdentifier },
			json: true,
			timeout: 30000,
			disableFollowRedirect: true,
			sendCredentialsOnCrossOriginRedirect: false,
		},
	);
});

test('buildRequestOptions sends multipart FormData as body without json or content type', () => {
	const formData = new FormData();
	formData.append('file', new Blob(['x'], { type: 'image/png' }), 'a.png');
	const options = buildRequestOptions('POST', 'https://api.postsider.com/public/v1/upload', {
		formData,
		timeout: 120000,
	});
	assert.equal(options.body, formData);
	assert.equal('json' in options, false);
	assert.equal(options.headers, undefined);
	assert.equal(options.timeout, 120000);
	assert.equal(options.disableFollowRedirect, true);
});

// ---- {msg} error bodies ----

const BAD_REQUEST = 'Bad request - please check your parameters';
const request = async (failure: unknown) => {
	const { context } = makeFakeContext({}, [failure]);
	try {
		await postSiderApiRequest.call(context, 'POST', '/posts');
	} catch (error) {
		return error as any;
	}
	assert.fail('the request should have failed');
};
const expectMsg = (error: any, status: string, msg: string) => {
	assert.ok(error instanceof NodeApiError);
	assert.equal(error.node.name, testNode.name);
	assert.equal(error.description, msg);
	assert.equal(String(error.httpCode), status);
	assert.equal(httpStatusOf(error), Number(status));
};

test('a NodeApiError whose context.data has a msg gets the msg as description and keeps n8n\'s message', async () => {
	const original = new NodeApiError(
		testNode,
		{ message: 'Request failed', response: { status: 400, data: { msg: 'Integration is disabled' } } } as JsonObject,
		{ httpCode: '400' },
	);
	assert.deepEqual((original.context as any).data, { msg: 'Integration is disabled' });
	const error = await request(original);
	expectMsg(error, '400', 'Integration is disabled');
	assert.equal(error.message, BAD_REQUEST);
	assert.equal(error, original, 'the original keeps its headers and cause');
});

test('a plain error with the body in cause.response.data.msg becomes a NodeApiError with that msg', async () => {
	const failure = Object.assign(new Error('Request failed with status code 400'), {
		statusCode: 400,
		cause: { response: { data: { msg: 'Post is not in the Error state' } } },
	});
	const error = await request(failure);
	expectMsg(error, '400', 'Post is not in the Error state');
	assert.equal(error.message, BAD_REQUEST);
	assert.equal(error.cause, failure);
});

test('the msg is read from response.data, response.body and error.error', async () => {
	const shapes: Array<[string, Record<string, unknown>]> = [
		['from response.data', { response: { data: { msg: 'A' } } }],
		['from response.body', { response: { body: { msg: 'B' } } }],
		['from a JSON string in response.body', { response: { body: '{"msg":"C"}' } }],
		['from error.error', { error: { msg: 'D' } }],
	];
	const expected = ['A', 'B', 'C', 'D'];
	for (const [index, [name, shape]] of shapes.entries()) {
		const failure = Object.assign(new Error('failed'), { statusCode: 403 }, shape);
		const error = await request(failure);
		expectMsg(error, '403', expected[index]);
		assert.equal(error.message, 'Forbidden - perhaps check your credentials?', name);
	}
});

test('the msg is read from a JSON description', async () => {
	const original = new NodeApiError(testNode, { message: 'failed' } as JsonObject, {
		httpCode: '402',
		description: '{"msg":"AI quota used up"}',
	});
	const error = await request(original);
	expectMsg(error, '402', 'AI quota used up');
	assert.equal(error.message, 'Payment required - perhaps check your payment details?');
	// a description that is plain text or invalid JSON stays as it is
	for (const description of ['Something broke', '{not json', '{"other":"x"}']) {
		const plain = new NodeApiError(testNode, { message: 'failed' } as JsonObject, { httpCode: '400', description });
		assert.equal(await request(plain), plain);
		assert.equal(plain.description, description);
	}
});

test('a msg in the body wins over a message in the same body', async () => {
	const failure = Object.assign(new Error('failed'), {
		statusCode: 400,
		response: { data: { msg: 'Use this', message: 'Not this' } },
	});
	expectMsg(await request(failure), '400', 'Use this');
});

test('Nest message bodies, empty msg values and errors without a status are left alone', async () => {
	const nest = new NodeApiError(
		testNode,
		{ message: 'failed', response: { status: 400, data: { statusCode: 400, message: ['content must not be empty'], error: 'Bad Request' } } } as JsonObject,
		{ httpCode: '400' },
	);
	assert.equal(await request(nest), nest);
	for (const msg of ['', '   ', 42, null, { text: 'x' }]) {
		const failure = Object.assign(new Error('failed'), { statusCode: 400, response: { data: { msg } } });
		assert.equal(await request(failure), failure, JSON.stringify(msg));
	}
	const noStatus = Object.assign(new Error('socket hang up'), { response: { data: { msg: 'x' } } });
	assert.equal(await request(noStatus), noStatus);
});

test('the missing route error still comes first', async () => {
	const failure = Object.assign(new Error('failed'), {
		statusCode: 404,
		response: { data: { msg: 'Some other text', message: 'Cannot POST /public/v1/policies/evaluate' } },
	});
	const error = await request(failure);
	assert.ok(error instanceof NodeApiError);
	assert.equal(error.message, MISSING_ROUTE_MESSAGE);
	assert.equal(error.description, MISSING_ROUTE_DESCRIPTION);
	assert.equal(MISSING_ROUTE_DESCRIPTION, 'The PostSider server you are connected to does not offer this feature.');
});

test('a 429 keeps its status and Retry-After after the msg is added', async () => {
	const plain = Object.assign(new Error('Too many requests'), {
		statusCode: 429,
		response: { headers: { 'Retry-After': '9' }, data: { msg: 'Rate limit reached', retryAfter: 9 } },
	});
	const error = await request(plain);
	expectMsg(error, '429', 'Rate limit reached');
	assert.equal(httpStatusOf(error), 429);
	assert.equal(retryAfterMsOf(error), 9000);
	const wrapped = new NodeApiError(testNode, { message: 'slow down' } as JsonObject, { httpCode: '429' });
	(wrapped as any).cause = { response: { headers: { 'retry-after': '4' }, data: { msg: 'Rate limit reached' } } };
	const rethrown = await request(wrapped);
	expectMsg(rethrown, '429', 'Rate limit reached');
	assert.equal(retryAfterMsOf(rethrown), 4000);
});

test('Wait for Result still treats a 429 with a msg as a pause, not a failure', async () => {
	const { waitForResult } = await import('../nodes/PostSider/v2/publish.ts');
	let calls = 0;
	const sleeps: number[] = [];
	const api = (async (method: any, endpoint: string, input?: unknown) => {
		const { context } = makeFakeContext({}, [
			calls++ === 0
				? Object.assign(new Error('Too many requests'), {
						statusCode: 429,
						response: { headers: { 'retry-after': '7' }, data: { msg: 'Rate limit reached', retryAfter: 7 } },
					})
				: { posts: [{ id: 'p1', state: 'PUBLISHED' }] },
		]);
		return postSiderApiRequest.call(context, method, endpoint, input as any);
	}) as never;
	const rows = await waitForResult(api, [{ postId: 'p1', state: 'QUEUE' }], 60, async (ms) => void sleeps.push(ms), 5000);
	assert.equal(rows[0].state, 'PUBLISHED');
	assert.equal(rows[0].pollError, undefined);
	assert.deepEqual(sleeps, [7000]);
});

test('serverMessageOf returns undefined for values without a msg', () => {
	for (const value of [undefined, null, 'text', 5, {}, { msg: 3 }, { context: { data: { message: 'x' } } }]) {
		assert.equal(serverMessageOf(value), undefined, JSON.stringify(value));
	}
	assert.equal(serverMessageOf({ context: { data: { msg: ' trimmed ' } } }), 'trimmed');
});
