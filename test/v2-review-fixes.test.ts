/* eslint-disable @n8n/community-nodes/no-restricted-imports, @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import test from 'node:test';

import { fieldProperties } from '../nodes/PostSider/resources/descriptions';
import { v2Properties } from '../nodes/PostSider/v2/descriptions';
import { executeV2 } from '../nodes/PostSider/v2/execute';
import { buildPostRequest } from '../nodes/PostSider/v2/postOperations';
import { PostSiderTrigger } from '../nodes/PostSiderTrigger/PostSiderTrigger.node.ts';
import { makeFakeContext, testNode } from './helpers';

const collection = (name: string) => v2Properties.find((p) => p.name === name) as any;
const collectionOptions = (name: string) => (collection(name).options as any[]).map((o) => o.name);
const topLevel = (resource: string, operation: string) =>
	v2Properties.filter((p) => {
		const show = p.displayOptions?.show as any;
		return show?.resource?.includes(resource) && show?.operation?.includes(operation);
	});

// ---- A1: Channel > Get Many ----

test('A1. Channel Get Many keeps Group and Include Disabled in a Filters collection', () => {
	const filters = collection('channelFilters');
	assert.equal(filters.type, 'collection');
	assert.equal(filters.placeholder, 'Add Filter');
	assert.deepEqual(filters.default, {});
	assert.deepEqual(collectionOptions('channelFilters'), ['groupId', 'includeDisabled']);
	const group = filters.options[0];
	assert.equal(group.displayName, 'Group Name or ID');
	assert.equal(group.typeOptions.loadOptionsMethod, 'getGroups');
	assert.deepEqual(
		topLevel('channel', 'getMany').map((p) => p.name).sort(),
		['channelFilters', 'limit', 'returnAll'],
	);
	// no top-level v2 groupId or includeDisabled shown for the channel resource
	for (const property of v2Properties) {
		const show = property.displayOptions?.show as any;
		if (['groupId', 'includeDisabled'].includes(property.name)) {
			assert.ok(!show?.resource?.includes('channel'), property.name);
		}
	}
});

test('A1. version 1 still has its top-level channel group filter', () => {
	const v1 = fieldProperties.find(
		(p) => p.name === 'groupId' && (p.displayOptions?.show?.resource as string[]).includes('channel'),
	);
	assert.ok(v1);
	assert.deepEqual(v1.displayOptions?.show?.['@version'], [1]);
});

test('A1. v2 Channel Get Many reads the filters collection', async () => {
	const { context, requests } = makeFakeContext(
		{
			resource: 'channel',
			operation: 'getMany',
			channelFilters: { groupId: 'g1', includeDisabled: true },
		},
		[[{ id: 'a' }, { id: 'b', disabled: true }]],
	);
	const out = await executeV2.call(context);
	assert.deepEqual(requests[0].qs, { group: 'g1' });
	assert.deepEqual(out[0].map((o: any) => o.json.id), ['a', 'b']);
});

// ---- A2: Media > Get Many ----

const mediaPage = (page: number, pages: number, count = 18) => ({
	pages,
	results: Array.from({ length: count }, (_, n) => ({ id: `m${page}-${n}` })),
});

test('A2. Media Get Many has Return All, Limit and a Filters collection with Search', () => {
	assert.deepEqual(topLevel('media', 'getMany').map((p) => p.name).sort(), [
		'limit',
		'mediaFilters',
		'returnAll',
	]);
	assert.deepEqual(collectionOptions('mediaFilters'), ['search']);
	const limit = topLevel('media', 'getMany').find((p) => p.name === 'limit') as any;
	assert.equal(limit.default, 50);
	assert.equal(limit.typeOptions.minValue, 1);
	assert.deepEqual(limit.displayOptions.show.returnAll, [false]);
});

test('A2. Limit fetches only the pages it needs and slices the result', async () => {
	const { context, requests } = makeFakeContext(
		{ resource: 'media', operation: 'getMany', returnAll: false, limit: 20 },
		[mediaPage(1, 5), mediaPage(2, 5), mediaPage(3, 5)],
	);
	const out = await executeV2.call(context);
	assert.equal(requests.length, 2);
	assert.deepEqual(requests.map((r) => r.qs), [{ page: 1 }, { page: 2 }]);
	assert.equal(out[0].length, 20);
	assert.equal((out[0][19].json as any).id, 'm2-1');
});

test('A2. Limit of 5 needs one page', async () => {
	const { context, requests } = makeFakeContext(
		{ resource: 'media', operation: 'getMany', returnAll: false, limit: 5 },
		[mediaPage(1, 5)],
	);
	const out = await executeV2.call(context);
	assert.equal(requests.length, 1);
	assert.equal(out[0].length, 5);
});

test('A2. Return All walks every page and passes the search term to each', async () => {
	const { context, requests } = makeFakeContext(
		{
			resource: 'media',
			operation: 'getMany',
			returnAll: true,
			mediaFilters: { search: ' logo ' },
		},
		[mediaPage(1, 3), mediaPage(2, 3), mediaPage(3, 3, 4)],
	);
	const out = await executeV2.call(context);
	assert.deepEqual(requests.map((r) => r.qs), [
		{ page: 1, search: 'logo' },
		{ page: 2, search: 'logo' },
		{ page: 3, search: 'logo' },
	]);
	assert.equal(out[0].length, 40);
});

test('A2. Return All stops after 50 pages', async () => {
	const responses = Array.from({ length: 60 }, (_, n) => mediaPage(n + 1, 999, 1));
	const { context, requests } = makeFakeContext(
		{ resource: 'media', operation: 'getMany', returnAll: true },
		responses,
	);
	const out = await executeV2.call(context);
	assert.equal(requests.length, 50);
	assert.equal(out[0].length, 50);
});

test('A2. an empty library returns no items and a bad limit is an error', async () => {
	const empty = makeFakeContext({ resource: 'media', operation: 'getMany', returnAll: true }, [
		{ pages: 0, results: [] },
	]);
	assert.deepEqual((await executeV2.call(empty.context))[0], []);
	const bad = makeFakeContext({ resource: 'media', operation: 'getMany', returnAll: false, limit: 0 }, []);
	await assert.rejects(() => executeV2.call(bad.context), /Limit/);
});

// ---- A3: Publishing > Pause ----

test('A3. Pause keeps Reason in Additional Fields', () => {
	assert.deepEqual(topLevel('publishing', 'pause').map((p) => p.name), ['pauseAdditionalFields']);
	const fields = collection('pauseAdditionalFields');
	assert.equal(fields.placeholder, 'Add Field');
	assert.deepEqual(collectionOptions('pauseAdditionalFields'), ['reason']);
});

test('A3. Pause without a reason posts an empty body', async () => {
	const { context, requests } = makeFakeContext({ resource: 'publishing', operation: 'pause' }, [{ state: 'PAUSED' }]);
	await executeV2.call(context);
	assert.deepEqual(requests[0].body, {});
});

// ---- A4: Post > Check ----

test('A4. Check keeps Media Type in an Options collection and has no Has Media field', () => {
	const options = collection('checkOptions');
	assert.equal(options.type, 'collection');
	assert.equal(options.placeholder, 'Add Option');
	assert.deepEqual(collectionOptions('checkOptions'), ['mediaType']);
	const mediaType = options.options[0];
	assert.deepEqual(mediaType.options.map((o: any) => o.name), ['Image', 'Mixed', 'None', 'Video']);
	assert.equal(mediaType.default, 'none');
	assert.deepEqual(topLevel('post', 'check').map((p) => p.name).sort(), ['checkOptions', 'platforms', 'text']);
});

test('A4. Check maps the media type to hasMedia and mediaType', () => {
	const body = (mediaType?: string) =>
		buildPostRequest(testNode, 'check', { text: 'Hi', platforms: ['x'], ...(mediaType ? { mediaType } : {}) }, new Date())
			.input.body;
	assert.deepEqual(body('none'), { content: 'Hi', hasMedia: false, platforms: ['x'] });
	assert.deepEqual(body('video'), { content: 'Hi', hasMedia: true, mediaType: 'video', platforms: ['x'] });
	assert.deepEqual(body('mixed'), { content: 'Hi', hasMedia: true, mediaType: 'mixed', platforms: ['x'] });
	assert.deepEqual(body('image'), { content: 'Hi', hasMedia: true, mediaType: 'image', platforms: ['x'] });
});

test('A4. the executor reads the Options collection', async () => {
	const { context, requests } = makeFakeContext(
		{ resource: 'post', operation: 'check', text: 'Hi', platforms: ['x'], checkOptions: { mediaType: 'video' } },
		[{ ok: true }],
	);
	await executeV2.call(context);
	assert.deepEqual(requests[0].body, { content: 'Hi', hasMedia: true, mediaType: 'video', platforms: ['x'] });
});

// ---- A5: PostSider Trigger ----

test('A5. the trigger asks for Trigger On and keeps channels in Options', () => {
	const { properties } = new PostSiderTrigger().description;
	const events = properties.find(
		(p) => p.name === 'events' && JSON.stringify(p.displayOptions?.show?.['@version']).includes('_cnd'),
	) as any;
	assert.equal(events.displayName, 'Trigger On');
	assert.equal(events.required, true);
	assert.equal(events.description, undefined);
	// version 1 keeps the 0.3.1 top-level fields, shown for version 1 only
	const v1Events = properties.find((p) => p.name === 'events' && !p.displayOptions?.show?.['@version']?.some?.((v: any) => v?._cnd)) as any;
	assert.equal(v1Events.displayName, 'Events');
	assert.equal(v1Events.description, 'Which post events start the workflow');
	assert.deepEqual(v1Events.displayOptions.show['@version'], [1]);
	assert.deepEqual(properties.find((p) => p.name === 'channels')?.displayOptions?.show?.['@version'], [1]);
	const options = properties.find((p) => p.name === 'options') as any;
	assert.equal(options.type, 'collection');
	assert.equal(options.placeholder, 'Add Option');
	assert.deepEqual(options.options.map((o: any) => o.name), ['channels']);
	assert.equal(options.options[0].displayName, 'Channel Names or IDs');
});

test('A5. poll filters by the channels in Options', async () => {
	const posts = [
		{ id: '1', state: 'PUBLISHED', publishDate: '2026-11-10T10:00:00.000Z', integration: { id: 'c1' } },
		{ id: '2', state: 'PUBLISHED', publishDate: '2026-11-11T10:00:00.000Z', integration: { id: 'c2' } },
	];
	const ctx: any = {
		getNodeParameter: (name: string, fallback?: unknown) =>
			({ events: ['published'], options: { channels: ['c1'] } })[name as 'events'] ?? fallback,
		getWorkflowStaticData: () => ({}),
		getMode: () => 'manual',
		getCredentials: async () => ({ baseUrl: 'https://api.postsider.com' }),
		getNode: () => ({ name: 'PostSider Trigger', typeVersion: 1.1 }),
		helpers: {
			httpRequestWithAuthentication: async () => ({ posts }),
			returnJsonArray: (items: unknown[]) => items.map((json) => ({ json })),
		},
	};
	const out = (await new PostSiderTrigger().poll.call(ctx)) as any[][];
	assert.equal(out[0].length, 1);
	assert.equal(out[0][0].json.id, '1');
});
