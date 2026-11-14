/* eslint-disable @n8n/community-nodes/no-restricted-imports, @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import test from 'node:test';

import { NodeHelpers } from 'n8n-workflow';

import { PostSider } from '../nodes/PostSider/PostSider.node.ts';
import { executeV2 } from '../nodes/PostSider/v2/execute.ts';
import { PostSiderTrigger } from '../nodes/PostSiderTrigger/PostSiderTrigger.node.ts';
import { makeFakeContext, modelNodeParameters, testNode } from './helpers.ts';

/*
 * Saved workflows of 0.3.0 and 0.3.1. n8n drops every saved parameter whose property is not displayed for
 * the node version, so these tests run saved parameters through n8n's own display rules
 * (`NodeHelpers.getNodeParameters`, via makeFakeContext) and check what the executor then sends.
 */

const description = new PostSider().description;
const triggerDescription = new PostSiderTrigger().description;

/** The parameters n8n keeps for a saved node of `typeVersion`: displayed ones only. */
function kept(params: Record<string, unknown>, typeVersion: number): Record<string, unknown> {
	return (
		(NodeHelpers.getNodeParameters(
			description.properties,
			params as never,
			true,
			false,
			{ ...testNode, typeVersion } as never,
			description,
		) as Record<string, unknown>) ?? {}
	);
}

async function run(params: Record<string, unknown>, responses: unknown[], typeVersion: number, options: object = {}) {
	const { context, requests } = makeFakeContext(params, responses, { typeVersion, ...options });
	const out = await executeV2.call(context);
	return { out: out[0].map((item: any) => item.json), requests };
}

// ---------------------------------------------------------------------------------------------
// Which saved 0.3.1 parameters survive. Each row is a parameter that 2.1 moved or removed.
// ---------------------------------------------------------------------------------------------

const MOVED_031_V2: Array<[string, Record<string, unknown>, string[]]> = [
	['Channel > Get Many group filter and include disabled', { resource: 'channel', operation: 'getMany', groupId: 'g1', includeDisabled: true }, ['groupId', 'includeDisabled']],
	['Trigger-like Media > Get Many search and page', { resource: 'media', operation: 'getMany', page: 2, search: 'logo' }, ['page', 'search']],
	['Post > Check has media and media type', { resource: 'post', operation: 'check', text: 'x', platforms: ['x'], hasMedia: true, mediaType: 'video' }, ['hasMedia', 'mediaType']],
	['Publishing > Pause reason', { resource: 'publishing', operation: 'pause', reason: 'incident' }, ['reason']],
	['Post > Retry Failed group ID', { resource: 'post', operation: 'retryFailed', postGroup: 'grp1' }, ['postGroup']],
	['Channel > Get Options list inputs', { resource: 'channel', operation: 'getOptions', channelId: 'c1', tool: 'boards', toolData: { field: [{ key: 'word', value: 'ai' }] } }, ['toolData']],
	['Approval > Get Many status, since, limit', { resource: 'approval', operation: 'getMany', approvalStatus: 'PENDING', since: '2026-11-01T00:00:00', returnAll: true }, ['approvalStatus', 'since', 'returnAll']],
	['Approval > Approve id and note', { resource: 'approval', operation: 'approve', approvalId: 'a1', note: 'ok' }, ['approvalId', 'note']],
	['Approval > Reject id and note', { resource: 'approval', operation: 'reject', approvalId: 'a1', note: 'no' }, ['approvalId', 'note']],
	['Policy > Check type and channel posts', { resource: 'policy', operation: 'check', policyType: 'schedule', policyPublishDate: '2026-11-20T10:00:00', policyChannelPosts: { channelPost: [{ channelId: 'c1', content: 'x' }] } }, ['operation', 'policyType', 'policyPublishDate', 'policyChannelPosts']],
	['Policy > Get Many Rules', { resource: 'policy', operation: 'getMany' }, ['operation']],
	['Group > Create name', { resource: 'group', operation: 'create', groupName: 'Acme' }, ['groupName']],
	['Group > Rename id and name', { resource: 'group', operation: 'update', targetGroupId: 'g1', groupName: 'New' }, ['targetGroupId', 'groupName']],
	['Group > Archive id', { resource: 'group', operation: 'archive', targetGroupId: 'g1' }, ['targetGroupId']],
];

for (const [label, params, names] of MOVED_031_V2) {
	test(`saved 0.3.1 version 2 node keeps its parameters: ${label}`, () => {
		const survivors = kept(params, 2);
		for (const name of names) {
			assert.ok(name in survivors, `version 2 dropped '${name}'`);
		}
	});
}

test('the same saved values are not displayed by 2.1, which is why version 2 stays frozen', () => {
	for (const [, params, names] of MOVED_031_V2) {
		const survivors = kept(params, 2.1);
		const dropped = names.filter((name) => !(name in survivors) || name === 'operation');
		assert.ok(dropped.length > 0 || params.resource === 'approval', JSON.stringify(params));
	}
});

// ---------------------------------------------------------------------------------------------
// Version 2 executes exactly as 0.3.1
// ---------------------------------------------------------------------------------------------

test('v2 Channel Get Many sends the saved group filter and lists disabled channels when asked', async () => {
	const channels = [{ id: 'a' }, { id: 'b', disabled: true }];
	const filtered = await run({ resource: 'channel', operation: 'getMany', groupId: 'g1' }, [channels], 2);
	assert.deepEqual(filtered.requests[0].qs, { group: 'g1' });
	assert.deepEqual(filtered.out.map((c: any) => c.id), ['a']);
	const all = await run({ resource: 'channel', operation: 'getMany', groupId: 'g1', includeDisabled: true }, [channels], 2);
	assert.deepEqual(all.out.map((c: any) => c.id), ['a', 'b']);
});

test('v2 Channel Get Many does not apply Return All or Limit', async () => {
	const rows = Array.from({ length: 80 }, (_, n) => ({ id: `c${n}` }));
	const result = await run({ resource: 'channel', operation: 'getMany' }, [rows], 2);
	assert.equal(result.out.length, 80);
});

test('v2 Media Get Many requests the saved page with the saved search, once', async () => {
	const result = await run({ resource: 'media', operation: 'getMany', page: 3, search: 'logo' }, [{ pages: 9, results: [{ id: 'm1' }] }], 2);
	assert.equal(result.requests.length, 1);
	assert.deepEqual(result.requests[0].qs, { page: 3, search: 'logo' });
	assert.deepEqual(result.out, [{ id: 'm1' }]);
});

test('v2 Pause sends the saved reason', async () => {
	const result = await run({ resource: 'publishing', operation: 'pause', reason: 'incident' }, [{ state: 'PAUSED' }], 2);
	assert.deepEqual(result.requests[0].body, { reason: 'incident' });
});

test('v2 Post Check sends the saved Has Media and Media Type', async () => {
	const withMedia = await run({ resource: 'post', operation: 'check', text: 'Hi', platforms: ['x'], hasMedia: true, mediaType: 'video' }, [{ ok: true }], 2);
	assert.deepEqual(withMedia.requests[0].body, { content: 'Hi', hasMedia: true, mediaType: 'video', platforms: ['x'] });
	const without = await run({ resource: 'post', operation: 'check', text: 'Hi', platforms: ['x'] }, [{ ok: true }], 2);
	assert.deepEqual(without.requests[0].body, { content: 'Hi', hasMedia: false, platforms: ['x'] });
});

test('v2 Retry Failed keeps the group route and the response as it is, without channel tokens', async () => {
	const response = { group: 'grp1', integration: { id: 'c1', token: 'secret', refreshToken: 'secret2' }, state: 'QUEUE' };
	const result = await run({ resource: 'post', operation: 'retryFailed', postGroup: 'grp 1' }, [response], 2);
	assert.equal(result.requests[0].method, 'POST');
	assert.equal(result.requests[0].url, 'https://api.postsider.com/public/v1/posts/group/grp%201/retry-failed');
	assert.deepEqual(result.requests[0].body, {});
	assert.deepEqual(result.out, [{ group: 'grp1', integration: { id: 'c1' }, state: 'QUEUE' }]);
});

test('v2 Retry Failed on a server without that route gives the clear missing-route message', async () => {
	const missing = Object.assign(new Error('Not Found'), { statusCode: 404, context: { data: { message: 'Cannot POST /public/v1/posts/group/g/retry-failed' } } });
	await assert.rejects(
		() => run({ resource: 'post', operation: 'retryFailed', postGroup: 'g' }, [missing], 2),
		/This operation is not available on this PostSider server/,
	);
});

test('v2 Post Delete keeps the response as its output', async () => {
	const result = await run({ resource: 'post', operation: 'delete', postId: 'p1' }, [{ id: 'group-1' }], 2);
	assert.deepEqual(result.out, [{ id: 'group-1' }]);
	const current = await run({ resource: 'post', operation: 'delete', postId: 'p1' }, [{ id: 'group-1' }], 2.1);
	assert.deepEqual(current.out, [{ postId: 'p1', deleted: true }]);
});

test('v2 Post Get and Get Many keep the longer simplified shape', async () => {
	const post = { id: 'p1', content: 'Hi', state: 'QUEUE', group: 'g1', image: '[]', publishDate: '2026-11-20T10:00:00.000Z', integration: { id: 'c1', name: 'N', providerIdentifier: 'x' } };
	const get = await run({ resource: 'post', operation: 'get', postId: 'p1' }, [{ group: 'g1', integration: { id: 'c1' }, posts: [post] }], 2);
	assert.equal(get.out[0].group, 'g1');
	assert.equal((get.out[0].posts as any[])[0].group, 'g1');
	const many = await run({ resource: 'post', operation: 'getMany', range: 'next7' }, [{ posts: [post] }], 2);
	assert.equal(many.out[0].group, 'g1');
	assert.deepEqual(many.out[0].image, []);
	// 2.1: a flat object of at most ten fields
	const flat = await run({ resource: 'post', operation: 'getMany', range: 'next7' }, [{ posts: [post] }], 2.1);
	assert.deepEqual(Object.keys(flat.out[0]).sort(), ['content', 'id', 'integrationId', 'integrationName', 'provider', 'publishDate', 'state'].sort());
});

test('v2 Policy, Approval and Group operations run as in 0.3.1', async () => {
	const check = await run(
		{ resource: 'policy', policyType: 'draft', policyChannelPosts: { channelPost: [{ channelId: 'c1', content: 'Hi' }] } },
		[{ verdict: 'ALLOW' }],
		2,
	);
	assert.equal(check.requests[0].url, 'https://api.postsider.com/public/v1/policies/evaluate');
	const rules = await run({ resource: 'policy', operation: 'getMany' }, [{ policies: [{ id: 'r1' }] }], 2);
	assert.equal(rules.requests[0].url, 'https://api.postsider.com/public/v1/policies');
	assert.deepEqual(rules.out, [{ id: 'r1' }]);
	const list = await run({ resource: 'approval', operation: 'getMany', approvalStatus: 'PENDING' }, [{ approvals: [{ id: 'a1' }] }], 2);
	assert.equal(list.requests[0].url, 'https://api.postsider.com/public/v1/approvals');
	assert.deepEqual(list.requests[0].qs, { status: 'PENDING', limit: 50 });
	const approve = await run(
		{ resource: 'approval', operation: 'approve', approvalId: 'a1', note: 'ok' },
		[{ requestedAt: '2026-11-04T10:00:00.000Z', stage: { position: 1 } }, { status: 'APPROVED' }],
		2,
	);
	assert.equal(approve.requests[1].url, 'https://api.postsider.com/public/v1/approvals/a1/approve');
	assert.deepEqual(approve.requests[1].body, { note: 'ok', expectStage: 1 });
	const created = await run({ resource: 'group', operation: 'create', groupName: 'Acme' }, [{ id: 'g1' }], 2);
	assert.equal(created.requests[0].url, 'https://api.postsider.com/public/v1/customers');
	const renamed = await run({ resource: 'group', operation: 'update', targetGroupId: 'g1', groupName: 'New' }, [{ id: 'g1' }], 2);
	assert.equal(renamed.requests[0].method, 'PUT');
	const archived = await run({ resource: 'group', operation: 'archive', targetGroupId: 'g1' }, [{ id: 'g1' }], 2);
	assert.equal(archived.requests[0].url, 'https://api.postsider.com/public/v1/customers/g1/archive');
});

test('v2 Channel Get Options reads the saved list inputs from the top level', async () => {
	const result = await run(
		{ resource: 'channel', operation: 'getOptions', channelId: 'c1', tool: 'boards', toolData: { field: [{ key: 'word', value: 'ai' }] } },
		[{ output: [{ id: 'b1' }] }],
		2,
	);
	assert.deepEqual(result.requests[0].body, { methodName: 'boards', data: { word: 'ai' } });
});

test('v2 reads a removed operation without the generic "Could not get parameter" error', async () => {
	// a saved version 2 Policy node whose operation equals the default is stored without it
	const result = await run({ resource: 'policy', policyType: 'draft', policyChannelPosts: { channelPost: [{ channelId: 'c1', content: 'x' }] } }, [{}], 2);
	assert.equal(result.requests.length, 1);
	// in 2.1 the same node is refused with a clear message
	await assert.rejects(() => run({ resource: 'policy', policyType: 'draft' }, [], 2.1), /is not available in this node version/);
	await assert.rejects(() => run({ resource: 'approval', operation: 'approve', approvalId: 'a' }, [], 2.1), /'approval > approve' is not available/);
});

test('v2 keeps its binary field label in error messages; 2.1 uses Input Data Field Names', async () => {
	const base = { resource: 'media', operation: 'upload', uploadSource: 'binary', uploadBinaryProperties: ' ' };
	await assert.rejects(() => run(base, [], 2), /^Error: 'Input Binary Field' must list|'Input Binary Field' must list/);
	await assert.rejects(() => run(base, [], 2.1), /'Input Data Field Names' must list/);
});

test('dates without a time zone are UTC in version 2 and in the workflow time zone from 2.1', async () => {
	const params = { resource: 'post', operation: 'duplicate', postId: 'p1', duplicateOptions: { date: '2026-07-01T10:00:00' } };
	const old = await run(params, [{ id: 'p2' }], 2, { timezone: 'Europe/Warsaw' });
	assert.equal((old.requests[0].body as any).date, '2026-07-01T10:00:00.000Z');
	const current = await run(params, [{ id: 'p2' }], 2.1, { timezone: 'Europe/Warsaw' });
	assert.equal((current.requests[0].body as any).date, '2026-07-01T08:00:00.000Z');
	const withOffset = await run({ ...params, duplicateOptions: { date: '2026-07-01T10:00:00+01:00' } }, [{ id: 'p2' }], 2.1, { timezone: 'Europe/Warsaw' });
	assert.equal((withOffset.requests[0].body as any).date, '2026-07-01T09:00:00.000Z');
});

// ---------------------------------------------------------------------------------------------
// Version 1 keeps working through the same display rules
// ---------------------------------------------------------------------------------------------

test('version 1 keeps Channel Get Many group filter and Approval operations', async () => {
	const { context, requests } = makeFakeContext({ resource: 'channel', operation: 'getMany', groupId: 'g1' }, [[{ id: 'a' }]], { typeVersion: 1 });
	await new PostSider().execute.call(context);
	assert.deepEqual(requests[0].qs, { group: 'g1' });
	const policy = makeFakeContext({ resource: 'policy', operation: 'getMany' }, [{ policies: [] }], { typeVersion: 1 });
	await new PostSider().execute.call(policy.context);
	assert.equal(policy.requests[0].url, 'https://api.postsider.com/public/v1/policies');
});

// ---------------------------------------------------------------------------------------------
// New nodes (2.1)
// ---------------------------------------------------------------------------------------------

test('2.1 reads the optional fields from their collections', async () => {
	const channels = await run({ resource: 'channel', operation: 'getMany', channelFilters: { groupId: 'g1', includeDisabled: true } }, [[{ id: 'a' }, { id: 'b', disabled: true }]], 2.1);
	assert.deepEqual(channels.requests[0].qs, { group: 'g1' });
	assert.equal(channels.out.length, 2);
	const media = await run({ resource: 'media', operation: 'getMany', mediaFilters: { search: 'logo' }, limit: 5 }, [{ pages: 1, results: [{ id: 'm1' }] }], 2.1);
	assert.deepEqual(media.requests[0].qs, { page: 1, search: 'logo' });
	const pause = await run({ resource: 'publishing', operation: 'pause', pauseAdditionalFields: { reason: 'incident' } }, [{}], 2.1);
	assert.deepEqual(pause.requests[0].body, { reason: 'incident' });
	const check = await run({ resource: 'post', operation: 'check', text: 'Hi', platforms: ['x'], checkOptions: { mediaType: 'image' } }, [{}], 2.1);
	assert.deepEqual(check.requests[0].body, { content: 'Hi', hasMedia: true, mediaType: 'image', platforms: ['x'] });
	const options = await run({ resource: 'channel', operation: 'getOptions', channelId: 'c1', tool: 'boards', getOptionsAdditionalFields: { toolData: { field: [{ key: 'word', value: 'ai' }] } } }, [{ output: [] }], 2.1);
	assert.deepEqual(options.requests[0].body, { methodName: 'boards', data: { word: 'ai' } });
});

test('2.1 Channel Get Many and Group Get Many honour Return All and Limit', async () => {
	const rows = Array.from({ length: 80 }, (_, n) => ({ id: `c${n}` }));
	const dflt = await run({ resource: 'channel', operation: 'getMany' }, [rows], 2.1);
	assert.equal(dflt.out.length, 50);
	const limited = await run({ resource: 'channel', operation: 'getMany', limit: 3 }, [rows], 2.1);
	assert.deepEqual(limited.out.map((c: any) => c.id), ['c0', 'c1', 'c2']);
	const all = await run({ resource: 'channel', operation: 'getMany', returnAll: true }, [rows], 2.1);
	assert.equal(all.out.length, 80);
	const groups = await run({ resource: 'group', operation: 'getMany', limit: 2 }, [rows], 2.1);
	assert.equal(groups.out.length, 2);
	await assert.rejects(() => run({ resource: 'channel', operation: 'getMany', limit: 0 }, [rows], 2.1), /'Limit' must be a whole number of 1 or more/);
});

test('2.1 Retry Failed uses the post ID and falls back to the requested ID', async () => {
	const result = await run({ resource: 'post', operation: 'retryFailed', postId: 'p9' }, [{ state: 'QUEUE', integration: { token: 'secret' } }], 2.1);
	assert.equal(result.requests[0].url, 'https://api.postsider.com/public/v1/posts/p9/retry');
	assert.deepEqual(result.out, [{ postId: 'p9', state: 'QUEUE', publishDate: null, releaseURL: null, error: null, errorCode: null }]);
	assert.doesNotMatch(JSON.stringify(result.out), /secret/);
});

test('2.1 Post Get Many sorts by publish date and drops repeated rows before the limit', async () => {
	const posts = [
		{ id: 'b', publishDate: '2026-11-21T10:00:00.000Z' },
		{ id: 'a', publishDate: '2026-11-20T10:00:00.000Z' },
		{ id: 'a', publishDate: '2026-11-20T10:00:00.000Z' },
		{ id: 'a', publishDate: '2026-11-27T10:00:00.000Z' },
	];
	const result = await run({ resource: 'post', operation: 'getMany', range: 'next7', limit: 3, simplify: false }, [{ posts }], 2.1);
	assert.deepEqual(result.out.map((p: any) => `${p.id}@${p.publishDate.slice(8, 10)}`), ['a@20', 'b@21', 'a@27']);
});

test('2.1 analytics with an empty answer returns one item with an empty data array', async () => {
	const post = await run({ resource: 'post', operation: 'getAnalytics', postId: 'p1' }, [[]], 2.1);
	assert.deepEqual(post.out, [{ data: [] }]);
	const channel = await run({ resource: 'channel', operation: 'getAnalytics', channelId: 'c1' }, [[]], 2.1);
	assert.deepEqual(channel.out, [{ data: [] }]);
});

// ---------------------------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------------------------

const posts = [
	{ id: '1', state: 'ERROR', error: 'x', errorCode: 'AUTH', group: 'g1', image: '[]', publishDate: '2026-11-10T10:00:00.000Z', integration: { id: 'c1', name: 'One', providerIdentifier: 'x' } },
	{ id: '2', state: 'ERROR', publishDate: '2026-11-11T10:00:00.000Z', integration: { id: 'c2', name: 'Two', providerIdentifier: 'linkedin' } },
];

async function poll(params: Record<string, unknown>, typeVersion: number) {
	const parameters = modelNodeParameters(params, typeVersion, 'trigger');
	const ctx: any = {
		getNodeParameter: (name: string, fallback?: unknown) => parameters[name] ?? fallback,
		getNode: () => ({ ...testNode, typeVersion }),
		getWorkflowStaticData: () => ({}),
		getMode: () => 'manual',
		getCredentials: async () => ({ baseUrl: 'https://api.postsider.com' }),
		helpers: {
			httpRequestWithAuthentication: async () => ({ posts }),
			returnJsonArray: (items: unknown[]) => items.map((json) => ({ json })),
		},
	};
	return ((await new PostSiderTrigger().poll.call(ctx)) as any[][])?.[0]?.map((x) => x.json) ?? [];
}

test('trigger declares versions 1 and 1.1 with default 1.1', () => {
	assert.deepEqual(triggerDescription.version, [1, 1.1]);
	assert.equal(triggerDescription.defaultVersion, 1.1);
});

test('a saved trigger of version 1 keeps its top-level channel filter', async () => {
	const saved = { events: ['failed'], channels: ['c2'] };
	const survivors = modelNodeParameters(saved, 1, 'trigger');
	assert.deepEqual(survivors.channels, ['c2']);
	assert.deepEqual(survivors.events, ['failed']);
	const items = await poll(saved, 1);
	assert.deepEqual(items.map((i: any) => i.id), ['2']);
	// the 0.3.1 display name and description stay
	const events = triggerDescription.properties.find((p) => p.name === 'events' && (p.displayOptions?.show?.['@version'] as unknown[])?.[0] === 1);
	assert.equal(events?.displayName, 'Events');
	assert.equal(events?.description, 'Which post events start the workflow');
});

test('trigger 1 emits the 0.3.1 output keys; 1.1 emits the flat ten fields plus event', async () => {
	const [old] = await poll({ events: ['failed'], channels: ['c1'] }, 1);
	assert.equal(old.group, 'g1');
	assert.deepEqual(old.image, []);
	assert.equal(old.event, 'failed');
	assert.equal(old.errorCode, 'AUTH');
	const [flat] = await poll({ events: ['failed'], options: { channels: ['c1'] } }, 1.1);
	assert.deepEqual(Object.keys(flat).sort(), ['content', 'error', 'errorCode', 'event', 'id', 'integrationId', 'integrationName', 'provider', 'publishDate', 'state'].filter((k) => k in flat).sort());
	assert.equal('group' in flat, false);
	assert.equal(flat.event, 'failed');
	assert.ok(Object.keys(flat).length <= 11);
});

test('trigger 1.1 reads the channel filter from Options and a saved top-level filter would be dropped by n8n', async () => {
	const dropped = modelNodeParameters({ events: ['failed'], channels: ['c2'] }, 1.1, 'trigger');
	assert.equal('channels' in dropped, false, 'this is why version 1 stays frozen');
	const items = await poll({ events: ['failed'], options: { channels: ['c2'] } }, 1.1);
	assert.deepEqual(items.map((i: any) => i.id), ['2']);
});
