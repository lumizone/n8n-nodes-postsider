/* eslint-disable @n8n/community-nodes/no-restricted-imports, @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { IDataObject } from 'n8n-workflow';

import { buildOperationRequest } from '../nodes/PostSider/shared/operations';
import { v2Properties } from '../nodes/PostSider/v2/descriptions';
import { executeV2 } from '../nodes/PostSider/v2/execute';
import { buildOtherRequest, shapeOtherOutput } from '../nodes/PostSider/v2/otherOperations';
import { testNode } from './helpers';

const build = (resource: string, operation: string, params: Record<string, unknown> = {}) =>
	buildOtherRequest(testNode, resource, operation, params as any, 'ex1', 0);

test('media getMany lists page 1 by default and sends the search term', () => {
	const r = build('media', 'getMany', {});
	assert.equal(r.method, 'GET');
	assert.equal(r.endpoint, '/media');
	assert.deepEqual(r.input.qs, { page: 1 });
	assert.deepEqual(build('media', 'getMany', { page: 3, search: ' logo ' }).input.qs, { page: 3, search: 'logo' });
	assert.throws(() => build('media', 'getMany', { page: 0 }), /Page/);
});

test('media delete encodes the id', () => {
	const r = build('media', 'delete', { mediaId: 'a/b' });
	assert.equal(r.method, 'DELETE');
	assert.equal(r.endpoint, '/media/a%2Fb');
	assert.throws(() => build('media', 'delete', { mediaId: ' ' }), /Media ID/);
});

test('channel getMany sends the group filter only when set', () => {
	assert.deepEqual(build('channel', 'getMany', {}).input, {});
	assert.deepEqual(build('channel', 'getMany', { groupId: 'g1' }).input.qs, { group: 'g1' });
});

test('channel id routes', () => {
	assert.equal(build('channel', 'getRules', { channelId: 'c/1' }).endpoint, '/integration-settings/c%2F1');
	assert.equal(build('channel', 'findNextSlot', { channelId: 'c1' }).endpoint, '/find-slot/c1');
	const enable = build('channel', 'enable', { channelId: 'c1' });
	assert.equal(enable.method, 'POST');
	assert.equal(enable.endpoint, '/integrations/c1/enable');
	assert.equal(build('channel', 'disable', { channelId: 'c1' }).endpoint, '/integrations/c1/disable');
	assert.throws(() => build('channel', 'enable', {}), /Channel/);
});

test('channel getAnalytics sends the number of days, default 7', () => {
	const r = build('channel', 'getAnalytics', { channelId: 'c1' });
	assert.equal(r.method, 'GET');
	assert.equal(r.endpoint, '/analytics/c1');
	assert.deepEqual(r.input.qs, { date: 7 });
	assert.deepEqual(build('channel', 'getAnalytics', { channelId: 'c1', days: 30.8 }).input.qs, { date: 30 });
	assert.throws(() => build('channel', 'getAnalytics', { channelId: 'c1', days: 0 }), /Days/);
});

test('publishing getState and pause', () => {
	const state = build('publishing', 'getState');
	assert.equal(state.method, 'GET');
	assert.equal(state.endpoint, '/publishing/state');
	const pause = build('publishing', 'pause', {});
	assert.equal(pause.method, 'POST');
	assert.equal(pause.endpoint, '/publishing/pause');
	assert.deepEqual(pause.input.body, {});
	assert.deepEqual(build('publishing', 'pause', { reason: ' incident ' }).input.body, { reason: 'incident' });
});

test('approval, policy and group delegate to the v1 builder', () => {
	assert.deepEqual(
		build('approval', 'getStatus', { postId: 'p1' }),
		buildOperationRequest(testNode, 'approval', 'getStatus', { postId: 'p1' }, 'ex1', 0),
	);
	assert.deepEqual(
		build('group', 'create', { groupName: 'Acme' }),
		buildOperationRequest(testNode, 'group', 'create', { groupName: 'Acme' }, 'ex1', 0),
	);
	assert.equal(build('policy', 'getMany').endpoint, '/policies');
});

test('approval approve on v2 uses the same idempotency key format as v1', () => {
	const params = { approvalId: 'appr_1', note: 'ok', stagePosition: 2, requestedAt: '2026-11-04T10:00:00.000Z', nodeName: 'PostSider' };
	const v2 = build('approval', 'approve', params);
	const v1 = buildOperationRequest(testNode, 'approval', 'approve', params as any, 'ex1', 0);
	assert.deepEqual(v2, v1);
	assert.match(
		String((v2.input.headers as any)['Idempotency-Key']),
		/^n8n:ex1:PostSider:item:0:[0-9a-f]{32}$/,
	);
});

test('unknown operations throw', () => {
	assert.throws(() => build('media', 'nope'), /Unsupported/);
});

test('shapeOtherOutput', () => {
	const rows = shapeOtherOutput('media', 'getMany', { pages: 1, results: [{ id: 'm1' }, { id: 'm2' }] }, {});
	assert.deepEqual(rows, [{ id: 'm1' }, { id: 'm2' }]);
	assert.deepEqual(shapeOtherOutput('media', 'getMany', [{ id: 'm1' }], {}), [{ id: 'm1' }]);
	assert.deepEqual(shapeOtherOutput('media', 'getMany', { pages: 1 }, {}), [{ pages: 1 }]);
	const channels = [{ id: 'a' }, { id: 'b', disabled: true }];
	assert.deepEqual(shapeOtherOutput('channel', 'getMany', channels, {}), [{ id: 'a' }]);
	assert.equal(shapeOtherOutput('channel', 'getMany', channels, { includeDisabled: true }).length, 2);
	assert.deepEqual(shapeOtherOutput('media', 'delete', {}, { mediaId: 'm1' }), [{ id: 'm1', deleted: true }]);
	assert.deepEqual(shapeOtherOutput('policy', 'getMany', { policies: [{ id: 'r1' }] }, {}), [{ id: 'r1' }]);
});

test('v2 declares the fields of every other resource for version 2 only', () => {
	const names = (resource: string, operation: string) =>
		v2Properties
			.filter((p) => {
				const show = p.displayOptions?.show as any;
				return show?.resource?.includes(resource) && show?.operation?.includes(operation);
			})
			.map((p) => p.name);
	assert.ok(names('media', 'upload').includes('uploadSource'));
	assert.ok(names('media', 'delete').includes('mediaId'));
	assert.deepEqual(names('media', 'getMany').sort(), ['page', 'search']);
	assert.deepEqual(names('channel', 'getMany').sort(), ['groupId', 'includeDisabled']);
	for (const op of ['getRules', 'findNextSlot', 'enable', 'disable']) {
		assert.deepEqual(names('channel', op), ['channelId'], op);
	}
	assert.deepEqual(names('channel', 'getAnalytics').sort(), ['channelId', 'days']);
	assert.deepEqual(names('publishing', 'pause'), ['reason']);
	assert.deepEqual(names('approval', 'approve').sort(), ['approvalId', 'note']);
	assert.deepEqual(names('approval', 'request'), ['postId']);
	assert.deepEqual(names('approval', 'getMany').sort(), ['approvalStatus', 'limit', 'returnAll', 'since']);
	assert.deepEqual(names('group', 'update').sort(), ['groupName', 'targetGroupId']);
	assert.deepEqual(names('policy', 'check').sort(), ['policyChannelPosts', 'policyPublishDate', 'policyType']);
	const groupId = v2Properties.find((p) => p.name === 'groupId');
	assert.equal(groupId?.typeOptions?.loadOptionsMethod, 'getGroups');
});

// ---- executor ----

function makeContext(params: Record<string, unknown>, responses: unknown[], extra: Record<string, unknown> = {}) {
	const requests: Array<Record<string, any>> = [];
	const context = {
		getInputData: () => [{ json: {}, binary: (extra.binary as any) ?? {} }],
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
			assertBinaryData: () => ({ fileName: 'a.png', mimeType: 'image/png' }),
			getBinaryDataBuffer: async () => Buffer.from('abc'),
			returnJsonArray: (d: IDataObject | IDataObject[]) => (Array.isArray(d) ? d : [d]).map((json) => ({ json })),
			constructExecutionMetaData: (d: any[], m: any) => d.map((e) => ({ ...e, pairedItem: m.itemData })),
		},
	} as any;
	return { context, requests };
}

test('executor: media upload from URLs outputs one item per file', async () => {
	const { context, requests } = makeContext(
		{ resource: 'media', operation: 'upload', uploadSource: 'url', uploadUrls: 'https://x.com/a.png\nhttps://x.com/b.png' },
		[{ id: 'm1', path: 'https://cdn/a.png' }, { id: 'm2', path: 'https://cdn/b.png' }],
	);
	const out = await executeV2.call(context);
	assert.equal(requests.length, 2);
	assert.equal(requests[0].url, 'https://api.postsider.com/public/v1/upload-from-url');
	assert.deepEqual(out[0].map((o: any) => o.json.id), ['m1', 'm2']);
	assert.deepEqual(out[0].map((o: any) => o.pairedItem), [{ item: 0 }, { item: 0 }]);
});

test('executor: media upload from binary uses upload-base64', async () => {
	const { context, requests } = makeContext(
		{ resource: 'media', operation: 'upload', uploadSource: 'binary', uploadBinaryProperties: 'data' },
		[{ id: 'm1', path: 'https://cdn/a.png' }],
	);
	const out = await executeV2.call(context);
	assert.equal(requests[0].url, 'https://api.postsider.com/public/v1/upload-base64');
	assert.equal(out[0][0].json.id, 'm1');
});

test('executor: channel getMany filters disabled channels client side', async () => {
	const { context, requests } = makeContext(
		{ resource: 'channel', operation: 'getMany', groupId: 'g1' },
		[[{ id: 'a' }, { id: 'b', disabled: true }]],
	);
	const out = await executeV2.call(context);
	assert.deepEqual(requests[0].qs, { group: 'g1' });
	assert.deepEqual(out[0].map((o: any) => o.json.id), ['a']);
});

test('executor: v2 approve reads the approval then sends a stage bound decision', async () => {
	const { context, requests } = makeContext(
		{ resource: 'approval', operation: 'approve', approvalId: 'appr_1', note: 'ok' },
		[{ id: 'appr_1', requestedAt: '2026-11-04T10:00:00.000Z', stage: { position: 2 } }, { status: 'APPROVED' }],
	);
	await executeV2.call(context);
	assert.equal(requests.length, 2);
	assert.equal(requests[0].method, 'GET');
	assert.deepEqual(requests[1].body, { note: 'ok', expectStage: 2 });
	assert.match(String(requests[1].headers['Idempotency-Key']), /^n8n:ex1:PostSider:item:0:[0-9a-f]{32}$/);
});

test('executor: v2 approval getMany maps approvalStatus to status and pages', async () => {
	const { context, requests } = makeContext(
		{ resource: 'approval', operation: 'getMany', approvalStatus: 'PENDING', returnAll: true },
		[{ approvals: [{ id: '1' }], nextCursor: 'c2' }, { approvals: [{ id: '2' }] }],
	);
	const out = await executeV2.call(context);
	assert.equal(requests[0].qs.status, 'PENDING');
	assert.equal(requests[1].qs.cursor, 'c2');
	assert.deepEqual(out[0].map((o: any) => o.json.id), ['1', '2']);
});

test('executor: publishing pause posts the reason', async () => {
	const { context, requests } = makeContext(
		{ resource: 'publishing', operation: 'pause', reason: 'incident' },
		[{ state: 'PAUSED' }],
	);
	const out = await executeV2.call(context);
	assert.equal(requests[0].url, 'https://api.postsider.com/public/v1/publishing/pause');
	assert.deepEqual(requests[0].body, { reason: 'incident' });
	assert.equal(out[0][0].json.state, 'PAUSED');
});
