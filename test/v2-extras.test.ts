/* eslint-disable @n8n/community-nodes/no-restricted-imports, @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { IDataObject } from 'n8n-workflow';

import { getChannelTools } from '../nodes/PostSider/methods/loadOptions';
import { v2Properties } from '../nodes/PostSider/v2/descriptions';
import { buildOtherRequest, shapeOtherOutput } from '../nodes/PostSider/v2/otherOperations';
import { buildPostRequest } from '../nodes/PostSider/v2/postOperations';
import {
	buildPublishRequest,
	executePublish,
	resetPublishCache,
	type PublishInput,
} from '../nodes/PostSider/v2/publish';
import { executeV2 } from '../nodes/PostSider/v2/execute';
import { testNode } from './helpers';

const NOW = new Date('2026-11-11T10:00:00.000Z');
const providers = { c1: 'x', c2: 'linkedin' };

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
const posts = (r: ReturnType<typeof buildPublishRequest>) =>
	(r.input.body as IDataObject).posts as Array<Record<string, any>>;
const DATE = '2026-11-11T10:00:00.000Z';

// ---- A. thread parts ----

test('thread parts follow the main text for every channel with their delays', () => {
	const media = [{ id: 'm1', path: 'https://cdn/m1.png' }];
	const r = buildPublishRequest(
		testNode,
		input({
			media,
			threadParts: [
				{ text: 'Two', delayMinutes: 5 },
				{ text: 'Three', delayMinutes: 0 },
			],
		}),
		providers,
		DATE,
	);
	for (const post of posts(r)) {
		assert.equal(post.value.length, 3);
		assert.deepEqual(post.value[0], { content: 'Hello', image: media });
		assert.deepEqual(post.value[1], { content: 'Two', image: [], delay: 5 });
		assert.deepEqual(post.value[2], { content: 'Three', image: [] });
		assert.equal('delay' in post.value[2], false);
	}
});

test('without thread parts the value has one entry', () => {
	const r = buildPublishRequest(testNode, input(), providers, DATE);
	assert.equal(posts(r)[0].value.length, 1);
});

test('an empty thread part throws with its number', () => {
	assert.throws(
		() =>
			buildPublishRequest(
				testNode,
				input({ threadParts: [{ text: 'ok', delayMinutes: 0 }, { text: '  ', delayMinutes: 0 }] }),
				providers,
				DATE,
			),
		/Thread part 2 needs text/,
	);
});

test('thread part delay must be a whole number from 0 to 1440', () => {
	for (const delayMinutes of [-1, 1441, 1.5, Number.NaN]) {
		assert.throws(
			() =>
				buildPublishRequest(
					testNode,
					input({ threadParts: [{ text: 'a', delayMinutes }] }),
					providers,
					DATE,
				),
			/Thread part 1 delay/,
			String(delayMinutes),
		);
	}
	const edge = buildPublishRequest(
		testNode,
		input({ threadParts: [{ text: 'a', delayMinutes: 1440 }] }),
		providers,
		DATE,
	);
	assert.equal(posts(edge)[0].value[1].delay, 1440);
});

test('a per-channel text override replaces only the first part', () => {
	const r = buildPublishRequest(
		testNode,
		input({ perChannelText: { c2: 'LinkedIn text' }, threadParts: [{ text: 'More', delayMinutes: 2 }] }),
		providers,
		DATE,
	);
	assert.equal(posts(r)[0].value[0].content, 'Hello');
	assert.equal(posts(r)[1].value[0].content, 'LinkedIn text');
	assert.deepEqual(posts(r)[1].value[1], { content: 'More', image: [], delay: 2 });
});

function makeCtx(params: Record<string, unknown>, responses: unknown[]) {
	const requests: Array<Record<string, any>> = [];
	const ctx = {
		getNodeParameter: (name: string, _i: number, fallback?: unknown) => params[name] ?? fallback,
		getExecutionId: () => 'exT',
		getCredentials: async () => ({ apiKey: 'k', baseUrl: 'https://api.postsider.com' }),
		getNode: () => testNode,
		getWorkflowDataProxy: () => ({ $runIndex: 0 }),
		helpers: {
			httpRequestWithAuthentication: async (_c: string, options: Record<string, unknown>) => {
				requests.push(options);
				return responses.shift();
			},
		},
	} as any;
	return { ctx, requests };
}
const base = { resource: 'post', operation: 'publish', channels: ['c1'], text: 'Hi', mediaSource: 'none', when: 'now' };
const integrations = [{ id: 'c1', name: 'X', identifier: 'x' }];

test('executePublish reads thread parts and validates before any request beyond the channel list', async () => {
	resetPublishCache();
	const bad = makeCtx(
		{ ...base, mediaSource: 'url', mediaUrls: 'https://e.com/a.png', options: { threadParts: { part: [{ text: '', delayMinutes: 0 }] } } },
		[integrations],
	);
	await assert.rejects(() => executePublish(bad.ctx, 0, {}, () => NOW, async () => {}), /Thread part 1 needs text/);
	assert.equal(bad.requests.length, 1);
	assert.match(String(bad.requests[0].url), /\/integrations$/);

	const ok = makeCtx(
		{ ...base, options: { threadParts: { part: [{ text: 'Reply', delayMinutes: 3 }] } } },
		[integrations, [{ postId: 'p1', integration: 'c1' }]],
	);
	await executePublish(ok.ctx, 0, {}, () => NOW, async () => {});
	const sent = ok.requests[1].body.posts[0].value;
	assert.deepEqual(sent, [
		{ content: 'Hi', image: [] },
		{ content: 'Reply', image: [], delay: 3 },
	]);
});

test('a retry with the same derived key but different thread parts is not served from the cache', async () => {
	resetPublishCache();
	const withParts = (text: string) => ({
		...base,
		mediaSource: 'url',
		mediaUrls: 'https://e.com/a.png',
		options: { threadParts: { part: [{ text, delayMinutes: 0 }] } },
	});
	const first = makeCtx(withParts('one'), [integrations, { id: 'm1', path: 'p' }, [{ postId: 'p1', integration: 'c1' }]]);
	await executePublish(first.ctx, 0, {}, () => NOW, async () => {});
	const second = makeCtx(withParts('two'), [integrations, { id: 'm2', path: 'p2' }, [{ postId: 'p2', integration: 'c1' }]]);
	await executePublish(second.ctx, 0, {}, () => NOW, async () => {});
	// changed parts change the fingerprint: media is uploaded again
	assert.equal(second.requests.length, 3);
	// identical retry reuses media
	const third = makeCtx(withParts('two'), [integrations, [{ postId: 'p2', integration: 'c1' }]]);
	await executePublish(third.ctx, 0, {}, () => NOW, async () => {});
	assert.equal(third.requests.length, 2);
	assert.deepEqual(third.requests[1].body.posts[0].value[0].image, [{ id: 'm2', path: 'p2' }]);
});

test('Thread Parts option is a multi-value collection with part text and delay', () => {
	const options = v2Properties.find(
		(p) => p.name === 'options' && (p.displayOptions?.show as any)?.operation?.includes('publish'),
	) as any;
	const field = options.options.find((o: any) => o.name === 'threadParts');
	assert.equal(field.displayName, 'Thread Parts');
	assert.equal(field.type, 'fixedCollection');
	assert.equal(field.typeOptions.multipleValues, true);
	const part = field.options[0];
	assert.equal(part.name, 'part');
	const text = part.values.find((v: any) => v.name === 'text');
	const delay = part.values.find((v: any) => v.name === 'delayMinutes');
	assert.equal(text.required, true);
	assert.ok(text.typeOptions.rows > 1);
	assert.equal(delay.type, 'number');
	assert.equal(delay.default, 0);
	assert.equal(delay.typeOptions.minValue, 0);
	assert.equal(delay.typeOptions.maxValue, 1440);
	assert.equal(delay.typeOptions.numberPrecision, 0);
	assert.equal(/[–—]/.test(JSON.stringify(field)), false);
});

// ---- B. change status ----

test('changeStatus puts the status on the encoded post id', () => {
	const r = buildPostRequest(testNode, 'changeStatus', { postId: 'a/b', status: 'draft' }, NOW);
	assert.equal(r.method, 'PUT');
	assert.equal(r.endpoint, '/posts/a%2Fb/status');
	assert.deepEqual(r.input.body, { status: 'draft' });
	assert.deepEqual(
		buildPostRequest(testNode, 'changeStatus', { postId: 'p1', status: 'schedule' }, NOW).input.body,
		{ status: 'schedule' },
	);
});

test('changeStatus defaults to schedule, rejects other values and needs an id', () => {
	assert.deepEqual(buildPostRequest(testNode, 'changeStatus', { postId: 'p1' }, NOW).input.body, {
		status: 'schedule',
	});
	assert.throws(() => buildPostRequest(testNode, 'changeStatus', { postId: 'p1', status: 'now' }, NOW), /Status/);
	assert.throws(() => buildPostRequest(testNode, 'changeStatus', { status: 'draft' }, NOW), /Post ID/);
});

test('changeStatus is declared for version 2 with postId and status', () => {
	const op = v2Properties.find(
		(p) => p.name === 'operation' && (p.displayOptions?.show as any)?.resource?.[0] === 'post',
	) as any;
	const option = op.options.find((o: any) => o.value === 'changeStatus');
	assert.equal(option.name, 'Change Status');
	assert.equal(option.action, 'Move a post between draft and queue');
	const fieldsFor = (name: string) =>
		v2Properties.filter((p) => {
			const show = p.displayOptions?.show as any;
			return p.name === name && show?.resource?.[0] === 'post' && show.operation.includes('changeStatus');
		});
	assert.equal(fieldsFor('postId').length, 1);
	const status = fieldsFor('status')[0] as any;
	assert.equal(status.default, 'schedule');
	assert.deepEqual(status.options.map((o: any) => o.value).sort(), ['draft', 'schedule']);
	assert.deepEqual((status.displayOptions.show as any)['@version'], [2]);
});

// ---- C. channel options ----

const build = (operation: string, params: Record<string, unknown>) =>
	buildOtherRequest(testNode, 'channel', operation, params as any, 'ex1', 0);

test('getOptions triggers the platform tool with its data map', () => {
	const r = build('getOptions', {
		channelId: 'c/1',
		tool: 'searchTags',
		toolData: { field: [{ key: 'word', value: 'ai' }, { key: '', value: 'skip' }] },
	});
	assert.equal(r.method, 'POST');
	assert.equal(r.endpoint, '/integration-trigger/c%2F1');
	assert.deepEqual(r.input.body, { methodName: 'searchTags', data: { word: 'ai' } });
	assert.deepEqual(build('getOptions', { channelId: 'c1', tool: 'boards' }).input.body, {
		methodName: 'boards',
		data: {},
	});
	assert.throws(() => build('getOptions', { channelId: 'c1', tool: ' ' }), /Option List Name or ID is required/);
	assert.throws(() => build('getOptions', { tool: 'boards' }), /Channel/);
});

test('getOptions output splits arrays and keeps single objects', () => {
	assert.deepEqual(
		shapeOtherOutput('channel', 'getOptions', { output: [{ id: 'b1' }, { id: 'b2' }] }, {}),
		[{ id: 'b1' }, { id: 'b2' }],
	);
	assert.deepEqual(shapeOtherOutput('channel', 'getOptions', { output: { x: 1 } }, {}), [{ x: 1 }]);
});

test('getOptions fields are version 2 only and use a dynamic tool list', () => {
	const fields = v2Properties.filter((p) => {
		const show = p.displayOptions?.show as any;
		return show?.resource?.[0] === 'channel' && show.operation?.includes('getOptions');
	});
	assert.deepEqual(fields.map((f) => f.name).sort(), ['channelId', 'tool', 'toolData']);
	const tool = fields.find((f) => f.name === 'tool') as any;
	assert.equal(tool.displayName, 'Option List Name or ID');
	assert.equal(tool.typeOptions.loadOptionsMethod, 'getChannelTools');
	assert.deepEqual(tool.typeOptions.loadOptionsDependsOn, ['channelId']);
	for (const f of fields) assert.deepEqual((f.displayOptions?.show as any)['@version'], [2]);
	const data = fields.find((f) => f.name === 'toolData') as any;
	assert.equal(data.options[0].name, 'field');
	assert.deepEqual(
		data.options[0].values.map((v: any) => v.name),
		['key', 'value'],
	);
});

function loadCtx(channelId: unknown, response: unknown) {
	const requests: Array<Record<string, any>> = [];
	const ctx = {
		getCurrentNodeParameter: (name: string) => (name === 'channelId' ? channelId : undefined),
		getCredentials: async () => ({ apiKey: 'k', baseUrl: 'https://api.postsider.com' }),
		getNode: () => testNode,
		helpers: {
			httpRequestWithAuthentication: async (_c: string, options: Record<string, unknown>) => {
				requests.push(options);
				return response;
			},
		},
	} as any;
	return { ctx, requests };
}

test('getChannelTools maps the tools of the selected channel', async () => {
	const { ctx, requests } = loadCtx('c/1', {
		output: {
			tools: [
				{ methodName: 'boards', description: 'List of boards', dataSchema: [] },
				{
					methodName: 'search',
					description: 'Search',
					dataSchema: [{ key: 'word', type: 'string', description: 'Search word' }],
				},
			],
		},
	});
	const result = await getChannelTools.call(ctx);
	assert.match(String(requests[0].url), /\/integration-settings\/c%2F1$/);
	assert.equal(result.length, 2);
	assert.equal(result[0].name, 'List of boards');
	assert.equal(result[0].value, 'boards');
	assert.equal(result[1].value, 'search');
	assert.match(String(result[1].description), /word/);
});

test('getChannelTools sorts options by name', async () => {
	const { ctx } = loadCtx('c1', {
		output: {
			tools: [
				{ methodName: 'z', description: 'Zeta' },
				{ methodName: 'a', description: 'Alpha' },
			],
		},
	});
	assert.deepEqual((await getChannelTools.call(ctx)).map((o) => o.value), ['a', 'z']);
});

test('getChannelTools is empty without a channel or tools', async () => {
	const none = loadCtx('', {});
	assert.deepEqual(await getChannelTools.call(none.ctx), []);
	assert.equal(none.requests.length, 0);
	assert.deepEqual(await getChannelTools.call(loadCtx('c1', {}).ctx), []);
	assert.deepEqual(await getChannelTools.call(loadCtx('c1', { output: { tools: null } }).ctx), []);
});

// ---- executor level ----

function execCtx(params: Record<string, unknown>, responses: unknown[]) {
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
	return { context, requests };
}

test('executor: Channel Get Options posts the tool call and splits the output', async () => {
	const { context, requests } = execCtx(
		{
			resource: 'channel',
			operation: 'getOptions',
			channelId: 'c/1',
			tool: 'boards',
			toolData: { field: [{ key: 'word', value: 'ai' }] },
		},
		[{ output: [{ id: 'b1' }, { id: 'b2' }] }],
	);
	const out = await executeV2.call(context);
	assert.equal(requests.length, 1);
	assert.equal(requests[0].method, 'POST');
	assert.equal(requests[0].url, 'https://api.postsider.com/public/v1/integration-trigger/c%2F1');
	assert.deepEqual(requests[0].body, { methodName: 'boards', data: { word: 'ai' } });
	assert.deepEqual(out[0].map((o: any) => o.json), [{ id: 'b1' }, { id: 'b2' }]);
});

test('executor: Post Change Status sends PUT with the status', async () => {
	const { context, requests } = execCtx(
		{ resource: 'post', operation: 'changeStatus', postId: 'a/b', status: 'draft' },
		[{ id: 'a/b', state: 'DRAFT', approvalRequested: false }],
	);
	const out = await executeV2.call(context);
	assert.equal(requests[0].method, 'PUT');
	assert.equal(requests[0].url, 'https://api.postsider.com/public/v1/posts/a%2Fb/status');
	assert.deepEqual(requests[0].body, { status: 'draft' });
	assert.equal(out[0][0].json.state, 'DRAFT');
});
