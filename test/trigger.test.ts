/* eslint-disable @n8n/community-nodes/no-restricted-imports */
import assert from 'node:assert/strict';
import test from 'node:test';

import { PostSiderTrigger } from '../nodes/PostSiderTrigger/PostSiderTrigger.node.ts';
import { pollWindow, selectNewPosts } from '../nodes/PostSiderTrigger/poll';

const post = (id: string, state: string, channel = 'c1', publishDate = '2026-11-10T10:00:00.000Z') => ({
	id,
	state,
	publishDate,
	integration: { id: channel, name: 'Ch', providerIdentifier: 'x' },
});

test('first run emits nothing and seeds', () => {
	const result = selectNewPosts([post('1', 'PUBLISHED')], ['published'], [], undefined);
	assert.deepEqual(result.emit, []);
	assert.deepEqual(result.seen, ['1:PUBLISHED']);
});

test('QUEUE then PUBLISHED emits once', () => {
	let seen = selectNewPosts([post('1', 'QUEUE')], ['published'], [], []).seen;
	let result = selectNewPosts([post('1', 'PUBLISHED')], ['published'], [], seen);
	assert.equal(result.emit.length, 1);
	assert.equal(result.emit[0].event, 'published');
	seen = result.seen;
	result = selectNewPosts([post('1', 'PUBLISHED')], ['published'], [], seen);
	assert.equal(result.emit.length, 0);
});

test('same PUBLISHED twice emits once', () => {
	const rows = [post('1', 'PUBLISHED'), post('1', 'PUBLISHED')];
	const result = selectNewPosts(rows, ['published'], [], []);
	assert.equal(result.emit.length, 1);
});

test('channel filter', () => {
	const rows = [post('1', 'PUBLISHED', 'c1'), post('2', 'PUBLISHED', 'c2')];
	const result = selectNewPosts(rows, ['published'], ['c2'], []);
	assert.deepEqual(result.emit.map((p) => p.id), ['2']);
});

test('failed and scheduled events map to ERROR and QUEUE', () => {
	const rows = [post('1', 'ERROR'), post('2', 'QUEUE'), post('3', 'DRAFT')];
	const result = selectNewPosts(rows, ['failed', 'scheduled'], [], []);
	assert.deepEqual(result.emit.map((p) => p.event), ['failed', 'scheduled']);
});

test('key absent from next response is dropped', () => {
	const first = selectNewPosts([post('1', 'QUEUE'), post('2', 'PUBLISHED')], ['published'], [], []);
	assert.deepEqual(first.seen, ['1:QUEUE', '2:PUBLISHED']);
	const second = selectNewPosts([post('2', 'PUBLISHED')], ['published'], [], first.seen);
	assert.deepEqual(second.seen, ['2:PUBLISHED']);
	assert.equal(second.emit.length, 0);
});

test('seen holds every state and channel, even unselected ones', () => {
	const result = selectNewPosts([post('1', 'DRAFT', 'c9')], ['published'], ['c1'], []);
	assert.deepEqual(result.seen, ['1:DRAFT']);
});

test('window is always now minus 7 days to now plus 30 days', () => {
	const now = new Date('2026-11-11T12:00:00.000Z');
	const w = pollWindow(now);
	assert.equal(w.startDate, '2026-11-04T12:00:00.000Z');
	assert.equal(w.endDate, '2026-12-11T12:00:00.000Z');
});

function fake(mode: string, params: Record<string, unknown>, staticData: Record<string, unknown>, posts: unknown[]) {
	const calls: unknown[] = [];
	const ctx = {
		getNodeParameter: (name: string, fallback?: unknown) => params[name] ?? fallback,
		getWorkflowStaticData: () => staticData,
		getMode: () => mode,
		getCredentials: async () => ({ baseUrl: 'https://api.postsider.com' }),
		getNode: () => ({ name: 'PostSider Trigger' }),
		helpers: {
			httpRequestWithAuthentication: async (_name: string, options: unknown) => {
				calls.push(options);
				return { posts };
			},
			returnJsonArray: (items: unknown[]) => items.map((json) => ({ json })),
		},
	};
	return { ctx, calls };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (ctx: any) => new PostSiderTrigger().poll.call(ctx);

test('poll seeds on first active run, then emits a newly published post', async () => {
	const staticData: Record<string, unknown> = {};
	const params = { events: ['published'], channels: [] };
	const first = fake('trigger', params, staticData, [post('1', 'QUEUE')]);
	assert.equal(await run(first.ctx), null);
	assert.deepEqual(staticData.seen, ['1:QUEUE']);
	const qs = (first.calls[0] as { qs: { startDate: string; endDate: string } }).qs;
	assert.ok(qs.startDate < qs.endDate);
	const second = fake('trigger', params, staticData, [post('1', 'PUBLISHED')]);
	const out = (await run(second.ctx)) as { json: Record<string, unknown> }[][];
	assert.equal(out[0].length, 1);
	assert.equal(out[0][0].json.event, 'published');
	assert.equal(out[0][0].json.id, '1');
	const third = fake('trigger', params, staticData, [post('1', 'PUBLISHED')]);
	assert.equal(await run(third.ctx), null);
});

test('manual mode returns newest match and leaves static data untouched', async () => {
	const staticData: Record<string, unknown> = {};
	const params = { events: ['published'], channels: [] };
	const rows = [
		post('1', 'PUBLISHED', 'c1', '2026-11-09T10:00:00.000Z'),
		post('2', 'PUBLISHED', 'c1', '2026-11-10T10:00:00.000Z'),
		post('3', 'QUEUE', 'c1', '2026-11-11T10:00:00.000Z'),
	];
	const out = (await run(fake('manual', params, staticData, rows).ctx)) as { json: Record<string, unknown> }[][];
	assert.equal(out[0].length, 1);
	assert.equal(out[0][0].json.id, '2');
	assert.deepEqual(staticData, {});
	assert.equal(await run(fake('manual', params, staticData, [post('3', 'QUEUE')]).ctx), null);
	assert.deepEqual(staticData, {});
});
