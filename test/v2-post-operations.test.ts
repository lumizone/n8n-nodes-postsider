/* eslint-disable @n8n/community-nodes/no-restricted-imports, @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildPostRequest,
	buildUpdateSettings,
	providerOfPost,
	shapePostOutput,
} from '../nodes/PostSider/v2/postOperations';
import { v2Properties } from '../nodes/PostSider/v2/descriptions';
import { testNode } from './helpers';

const NOW = new Date('2026-11-11T10:00:00.000Z');
const build = (operation: string, params: Record<string, unknown> = {}) =>
	buildPostRequest(testNode, operation, params as any, NOW);

test('get requests the post by id', () => {
	const r = build('get', { postId: 'p1' });
	assert.equal(r.method, 'GET');
	assert.equal(r.endpoint, '/posts/p1');
});

test('ids are url encoded', () => {
	assert.equal(build('get', { postId: 'a/b c' }).endpoint, '/posts/a%2Fb%20c');
	assert.equal(build('delete', { postId: 'a/b' }).endpoint, '/posts/a%2Fb');
	assert.equal(build('duplicate', { postId: 'a/b' }).endpoint, '/posts/a%2Fb/duplicate');
	assert.equal(build('retryFailed', { postGroup: 'g/1' }).endpoint, '/posts/group/g%2F1/retry-failed');
	assert.equal(build('getAnalytics', { postId: 'a/b' }).endpoint, '/analytics/post/a%2Fb');
});

test('a missing id throws', () => {
	assert.throws(() => build('get', { postId: '  ' }), /Post ID/);
	assert.throws(() => build('retryFailed', {}), /Group ID/);
});

test('getMany next7 computes a 7 day window from now', () => {
	const r = build('getMany', { range: 'next7' });
	assert.equal(r.method, 'GET');
	assert.equal(r.endpoint, '/posts');
	assert.deepEqual(r.input.qs, {
		startDate: '2026-11-11T10:00:00.000Z',
		endDate: '2026-11-18T10:00:00.000Z',
	});
});

test('getMany defaults to next7 when range is missing', () => {
	assert.equal((build('getMany', {}).input.qs as any).endDate, '2026-11-18T10:00:00.000Z');
});

test('getMany last7 looks back 7 days', () => {
	const qs = build('getMany', { range: 'last7' }).input.qs as any;
	assert.equal(qs.startDate, '2026-11-04T10:00:00.000Z');
	assert.equal(qs.endDate, '2026-11-11T10:00:00.000Z');
});

test('getMany custom needs both dates and normalizes them', () => {
	const qs = build('getMany', {
		range: 'custom',
		startDate: '2026-11-01T00:00:00',
		endDate: '2026-11-02T00:00:00+01:00',
	}).input.qs as any;
	assert.equal(qs.startDate, '2026-11-01T00:00:00.000Z');
	assert.equal(qs.endDate, '2026-11-01T23:00:00.000Z');
	assert.throws(() => build('getMany', { range: 'custom', startDate: '2026-11-01T00:00:00' }), /both/);
	assert.throws(() => build('getMany', { range: 'custom', endDate: '2026-11-01T00:00:00' }), /both/);
});

test('getMany sends state and channel filters only when set', () => {
	const qs = build('getMany', { range: 'next7', state: 'ERROR', channel: 'c1' }).input.qs as any;
	assert.equal(qs.state, 'ERROR');
	assert.equal(qs.integration, 'c1');
	const none = build('getMany', { range: 'next7', state: 'any', channel: '' }).input.qs as any;
	assert.equal('state' in none, false);
	assert.equal('integration' in none, false);
});

test('update sends only the provided fields', () => {
	const r = build('update', { postId: 'p1', text: 'New', date: '2026-12-01T09:00:00' });
	assert.equal(r.method, 'PUT');
	assert.equal(r.endpoint, '/posts/p1');
	assert.deepEqual(r.input.body, { content: 'New', date: '2026-12-01T09:00:00.000Z' });
});

test('update can send first comment, images and settings', () => {
	const r = build('update', {
		postId: 'p1',
		firstComment: 'hi',
		images: [{ id: 'm1', path: 'https://x/y.png' }],
		settings: { title: 'T' },
	});
	assert.deepEqual(r.input.body, {
		firstComment: 'hi',
		images: [{ id: 'm1', path: 'https://x/y.png' }],
		settings: { title: 'T' },
	});
});

test('update with nothing throws', () => {
	assert.throws(() => build('update', { postId: 'p1' }), /Set at least one field to update/);
	assert.throws(() => build('update', { postId: 'p1', settings: {} }), /Set at least one field to update/);
});

test('delete, duplicate and retryFailed', () => {
	const del = build('delete', { postId: 'p1' });
	assert.equal(del.method, 'DELETE');
	assert.equal(del.endpoint, '/posts/p1');
	assert.deepEqual(build('duplicate', { postId: 'p1' }).input.body, {});
	assert.deepEqual(
		build('duplicate', { postId: 'p1', channelId: 'c2', date: '2026-12-01T09:00:00' }).input.body,
		{ channelId: 'c2', date: '2026-12-01T09:00:00.000Z' },
	);
	const retry = build('retryFailed', { postGroup: 'g1' });
	assert.equal(retry.method, 'POST');
	assert.equal(retry.endpoint, '/posts/group/g1/retry-failed');
	assert.deepEqual(retry.input.body, {});
});

test('check builds the body with provider identifiers', () => {
	const r = build('check', { text: 'Hello', hasMedia: true, mediaType: 'image', platforms: ['x', 'linkedin'] });
	assert.equal(r.method, 'POST');
	assert.equal(r.endpoint, '/posts/check');
	assert.deepEqual(r.input.body, {
		content: 'Hello',
		hasMedia: true,
		mediaType: 'image',
		platforms: ['x', 'linkedin'],
	});
	const plain = build('check', { text: 'Hello', hasMedia: false, mediaType: 'image', platforms: ['x'] });
	assert.deepEqual(plain.input.body, { content: 'Hello', hasMedia: false, platforms: ['x'] });
});

test('check validates platforms and length', () => {
	assert.throws(() => build('check', { text: 'a', platforms: [] }), /at least one platform/i);
	assert.throws(() => build('check', { text: 'a', platforms: ['x', 'bluesky', 'threads', 'mastodon'] }), /at most 3/i);
	assert.throws(() => build('check', { text: 'x'.repeat(4001), platforms: ['x'] }), /4000/);
});

test('rewrite builds the body and bounds count', () => {
	const r = build('rewrite', { text: 'Hello', tone: 'punchy', count: 3, platform: 'x' });
	assert.equal(r.method, 'POST');
	assert.equal(r.endpoint, '/posts/rewrite');
	assert.deepEqual(r.input.body, { content: 'Hello', tone: 'punchy', count: 3, platform: 'x' });
	assert.deepEqual(build('rewrite', { text: 'Hello' }).input.body, { content: 'Hello' });
	assert.throws(() => build('rewrite', { text: 'Hello', count: 6 }), /between 1 and 5/);
	assert.throws(() => build('rewrite', { text: 'Hello', count: 0 }), /between 1 and 5/);
	assert.throws(() => build('rewrite', { text: '  ' }), /Text/);
});

test('getAnalytics sends days with default 7', () => {
	const r = build('getAnalytics', { postId: 'p1' });
	assert.equal(r.method, 'GET');
	assert.equal(r.endpoint, '/analytics/post/p1');
	assert.deepEqual(r.input.qs, { date: 7 });
	assert.deepEqual(build('getAnalytics', { postId: 'p1', days: 30 }).input.qs, { date: 30 });
	assert.throws(() => build('getAnalytics', { postId: 'p1', days: 0 }), /Days/);
});

test('an unknown operation throws', () => {
	assert.throws(() => build('nope', {}), /Unsupported/);
});

test('buildUpdateSettings sends only what the user gave, without defaults', () => {
	assert.deepEqual(buildUpdateSettings('x', {}, {}), {});
	assert.deepEqual(buildUpdateSettings('youtube', { title: 'New title' }, {}), { title: 'New title' });
	assert.deepEqual(buildUpdateSettings('x', { xWhoCanReply: 'everyone' }, {}), {
		who_can_reply_post: 'everyone',
	});
	// platform fields for other providers are ignored
	assert.deepEqual(buildUpdateSettings('linkedin', { xWhoCanReply: 'following' }, {}), {});
	// settings JSON wins over the fields
	assert.deepEqual(buildUpdateSettings('youtube', { title: 'A' }, { title: 'B', type: 'private' }), {
		title: 'B',
		type: 'private',
	});
});

test('providerOfPost reads the provider from the post detail', () => {
	assert.equal(
		providerOfPost({ posts: [{ id: 'p1', integration: { providerIdentifier: 'youtube' } }] }),
		'youtube',
	);
	assert.throws(() => providerOfPost({ posts: [] }), /provider/);
});

test('get output simplifies by default and passes the raw post otherwise', () => {
	const response = {
		group: 'g1',
		integration: 'c1',
		settings: { a: 1 },
		posts: [
			{
				id: 'p1',
				content: 'Hi',
				state: 'QUEUE',
				secret: 'x',
				integration: { id: 'c1', name: 'N', providerIdentifier: 'x' },
			},
		],
	};
	const [simple] = shapePostOutput('get', response, { simplify: true });
	assert.equal((simple.posts as any[])[0].integrationName, 'N');
	assert.equal('secret' in (simple.posts as any[])[0], false);
	const [raw] = shapePostOutput('get', response, { simplify: false });
	assert.equal((raw.posts as any[])[0].secret, 'x');
});

test('getMany outputs one item per post and applies the client side limit', () => {
	const posts = Array.from({ length: 5 }, (_, n) => ({
		id: `p${n}`,
		content: 'c',
		state: 'QUEUE',
		integration: { id: 'c1', name: 'N', providerIdentifier: 'x' },
	}));
	const limited = shapePostOutput('getMany', { posts }, { simplify: true, returnAll: false, limit: 2 });
	assert.equal(limited.length, 2);
	assert.equal(limited[0].integrationId, 'c1');
	assert.equal(shapePostOutput('getMany', { posts }, { simplify: true, returnAll: true, limit: 2 }).length, 5);
	// default limit is 50
	const many = Array.from({ length: 60 }, (_, n) => ({ id: `p${n}` }));
	assert.equal(shapePostOutput('getMany', { posts: many }, { simplify: false, returnAll: false }).length, 50);
	// empty list: no items
	assert.equal(shapePostOutput('getMany', { posts: [] }, { simplify: true, returnAll: true }).length, 0);
});

test('other operations return the response as items', () => {
	assert.deepEqual(shapePostOutput('delete', { id: 'g1' }, {}), [{ id: 'g1' }]);
	assert.deepEqual(shapePostOutput('retryFailed', { results: [] }, {}), [{ results: [] }]);
	assert.equal(shapePostOutput('rewrite', [{ text: 'a' }, { text: 'b' }], {}).length, 2);
});

test('v2 post operation fields are version 2 only and use plain wording', () => {
	const ops = ['get', 'getMany', 'update', 'delete', 'duplicate', 'retryFailed', 'check', 'rewrite', 'getAnalytics'];
	const fields = v2Properties.filter((p) => {
		const show = p.displayOptions?.show as Record<string, unknown[]> | undefined;
		return (
			p.name !== 'operation' &&
			show?.resource?.[0] === 'post' &&
			(show.operation ?? []).some((o) => ops.includes(String(o)))
		);
	});
	assert.ok(fields.length > 10);
	for (const field of fields) {
		assert.deepEqual((field.displayOptions?.show as any)['@version'], [2], field.name);
		assert.equal(/[–—]/.test(JSON.stringify(field)), false, field.name);
	}
	const forOp = (op: string) =>
		fields.filter((f) => ((f.displayOptions?.show as any).operation as string[]).includes(op)).map((f) => f.name);
	assert.ok(forOp('delete').includes('postId'));
	assert.ok(forOp('getMany').includes('returnAll'));
	assert.ok(forOp('check').includes('platforms'));
	const del = fields.find((f) => f.name === 'postId' && (f.displayOptions!.show as any).operation.includes('delete'));
	assert.match(String(del!.description), /whole post group/i);
});

async function runExecutor(params: Record<string, unknown>, responses: unknown[]) {
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
			returnJsonArray: (d: any) => (Array.isArray(d) ? d : [d]).map((json: any) => ({ json })),
			constructExecutionMetaData: (d: any[], m: any) => d.map((e) => ({ ...e, pairedItem: m.itemData })),
		},
	} as any;
	const result = await executeV2.call(context);
	return { result, requests };
}

test('executor: update with platform settings reads the provider first and sends no defaults', async () => {
	const { result, requests } = await runExecutor(
		{
			resource: 'post',
			operation: 'update',
			postId: 'p1',
			updateFields: { platformSettings: { youtubeVisibility: 'private' } },
		},
		[{ group: 'g', posts: [{ id: 'p1', integration: { providerIdentifier: 'youtube' } }] }, [{ postId: 'p1' }]],
	);
	assert.equal(requests.length, 2);
	assert.equal(requests[0].method, 'GET');
	assert.equal(requests[1].method, 'PUT');
	assert.deepEqual(requests[1].body, { settings: { type: 'private' } });
	assert.equal(result[0].length, 1);
});

test('executor: update with only text does not read the post', async () => {
	const { requests } = await runExecutor(
		{ resource: 'post', operation: 'update', postId: 'p1', updateFields: { text: 'Edited' } },
		[[{ postId: 'p1' }]],
	);
	assert.equal(requests.length, 1);
	assert.deepEqual(requests[0].body, { content: 'Edited' });
});

test('executor: update replaces media from URLs after validation', async () => {
	const { requests } = await runExecutor(
		{
			resource: 'post',
			operation: 'update',
			postId: 'p1',
			updateFields: {},
			updateMediaSource: 'url',
			updateMediaUrls: 'https://example.com/a.png',
		},
		[{ id: 'm1', path: 'https://cdn/a.png' }, [{ postId: 'p1' }]],
	);
	assert.equal(requests.length, 2);
	assert.ok(String(requests[0].url).endsWith('/upload-from-url'));
	assert.deepEqual(requests[1].body, { images: [{ id: 'm1', path: 'https://cdn/a.png' }] });
});

test('executor: invalid media URL or empty update fails before any request', async () => {
	await assert.rejects(
		() =>
			runExecutor(
				{ resource: 'post', operation: 'update', postId: 'p1', updateFields: { text: 'x' }, updateMediaSource: 'url', updateMediaUrls: 'http://bad' },
				[],
			),
		/public HTTPS/,
	);
	await assert.rejects(
		() => runExecutor({ resource: 'post', operation: 'update', postId: 'p1', updateFields: {} }, []),
		/Set at least one field to update/,
	);
});

test('executor: update can remove all media', async () => {
	const { requests } = await runExecutor(
		{ resource: 'post', operation: 'update', postId: 'p1', updateFields: {}, updateMediaSource: 'remove' },
		[[{ postId: 'p1' }]],
	);
	assert.deepEqual(requests[0].body, { images: [] });
});

test('executor: getMany returns one item per post', async () => {
	const { result, requests } = await runExecutor(
		{ resource: 'post', operation: 'getMany', range: 'next7', returnAll: false, limit: 1, simplify: true },
		[{ posts: [{ id: 'a' }, { id: 'b' }] }],
	);
	assert.equal(result[0].length, 1);
	assert.equal(result[0][0].json.id, 'a');
	assert.equal(requests[0].method, 'GET');
});
