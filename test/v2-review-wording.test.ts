/* eslint-disable @n8n/community-nodes/no-restricted-imports, @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { INodeProperties } from 'n8n-workflow';

import { PostSiderApi } from '../credentials/PostSiderApi.credentials';
import { PostSider } from '../nodes/PostSider/PostSider.node.ts';
import { fieldProperties, operationProperties } from '../nodes/PostSider/resources/descriptions';
import { v2Properties } from '../nodes/PostSider/v2/descriptions';
import { executeV2 } from '../nodes/PostSider/v2/execute';
import { PostSiderTrigger } from '../nodes/PostSiderTrigger/PostSiderTrigger.node.ts';
import { makeFakeContext } from './helpers';

const trigger = new PostSiderTrigger().description.properties;
const credential = new PostSiderApi().properties;
const v2Operations = v2Properties.filter((p) => p.name === 'operation');

/** Every property of the node, its nested collection options and fixed collection values. */
function walk(properties: readonly any[], visit: (property: any, path: string) => void, path = ''): void {
	for (const property of properties) {
		const here = `${path}/${property.name}`;
		visit(property, here);
		for (const option of property.options ?? []) {
			if (option.values) walk(option.values, visit, `${here}/${option.name}`);
			else if (option.displayName) walk([option], visit, here);
		}
	}
}

const findV2 = (name: string, resource?: string) =>
	v2Properties.find(
		(p) =>
			p.name === name &&
			(resource === undefined || (p.displayOptions?.show?.resource as string[] | undefined)?.includes(resource)),
	) as any;

// ---- C17 ----

test('C17. operation actions carry no articles in version 1 or version 2', () => {
	const operations = [...operationProperties, ...v2Operations];
	let count = 0;
	for (const property of operations) {
		for (const option of property.options as any[]) {
			count++;
			assert.equal(/\b(a|an|the)\b/i.test(option.action), false, option.action);
		}
	}
	assert.ok(count > 30);
	const action = (resource: string, value: string) =>
		(findV2('operation', resource).options as any[]).find((o) => o.value === value).action;
	assert.equal(action('post', 'get'), 'Get post');
	assert.equal(action('approval', 'request'), 'Request approval for post');
	assert.equal(action('channel', 'findNextSlot'), 'Find next free queue slot for channel');
	assert.equal(action('channel', 'getOptions'), 'Get options from channel platform');
});

// ---- C18 ----

test('C18. Simplify has the exact standard description', () => {
	for (const simplify of v2Properties.filter((p) => p.name === 'simplify')) {
		assert.equal(simplify.description, 'Whether to return a simplified version of the response instead of the raw data');
	}
});

// ---- C19 ----

test('C19. every placeholder is an "Add ..." button label or starts with "e.g."', () => {
	let examples = 0;
	for (const [label, properties] of Object.entries({
		v1: fieldProperties,
		v2: v2Properties,
		trigger,
		credential,
	})) {
		walk(properties, (property, path) => {
			if (property.placeholder === undefined) return;
			const isButton = ['collection', 'fixedCollection'].includes(property.type);
			if (isButton) assert.match(property.placeholder, /^Add [A-Z]/, `${label}${path}`);
			else {
				examples++;
				assert.match(property.placeholder, /^e\.g\. /, `${label}${path}`);
			}
		});
	}
	assert.ok(examples >= 5);
	const platform = findV2('options', 'post').options.find((o: any) => o.name === 'platformSettings');
	const community = platform.options.find((o: any) => o.name === 'xCommunity');
	assert.equal(community.placeholder, 'e.g. https://x.com/i/communities/1493446837214187523');
});

// ---- C20 ----

test('C20. every options list in version 2, the trigger and the credential is sorted by name', () => {
	let lists = 0;
	for (const [label, properties] of Object.entries({ v2: v2Properties, trigger, credential })) {
		walk(properties, (property, path) => {
			// Lists loaded from the API have no static options and are sorted by the load method.
			if (!['options', 'multiOptions'].includes(property.type) || !property.options) return;
			lists++;
			const names: string[] = property.options.map((o: any) => o.name);
			assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), `${label}${path}`);
		});
	}
	assert.ok(lists > 30);
	assert.deepEqual(
		findV2('mediaSource').options.map((o: any) => o.name),
		['Already Uploaded', 'Binary Data', 'None', 'Public URLs'],
	);
});

// ---- C21 ----

test('C21. Retry Failed asks for the Post ID of a post in the Error state', async () => {
	const field = v2Properties.find(
		(p) => p.name === 'postId' && (p.displayOptions?.show?.operation as string[]).includes('retryFailed'),
	) as any;
	assert.deepEqual(field.displayOptions.show.operation, ['retryFailed']);
	assert.equal(field.displayName, 'Post ID');
	assert.equal(field.required, true);
	assert.match(field.description, /Error state/);
	assert.match(field.description, /publishing must not be paused/);
	assert.equal(findV2('postGroup'), undefined);
	const { context } = makeFakeContext({ resource: 'post', operation: 'retryFailed' }, []);
	await assert.rejects(() => executeV2.call(context), /'Post ID' is required/);
});

// ---- C22 ----

test('C22. descriptions only refer to operations that exist', () => {
	const operationsOf = new Map<string, string[]>();
	const resourceNames = new Map<string, string>();
	for (const property of [...operationProperties, ...v2Operations]) {
		const value = (property.displayOptions?.show?.resource as string[])[0];
		const names = operationsOf.get(value) ?? [];
		for (const option of property.options as any[]) names.push(option.name);
		operationsOf.set(value, names);
	}
	for (const resource of (v2Properties[0].options as any[])) resourceNames.set(resource.name, resource.value);
	resourceNames.set('Scheduling', 'scheduling');
	const strings: string[] = [];
	walk([...fieldProperties, ...v2Properties], (property) => {
		if (typeof property.description === 'string') strings.push(property.description);
		for (const option of property.options ?? []) {
			if (typeof option.description === 'string') strings.push(option.description);
		}
	});
	let checked = 0;
	for (const text of strings) {
		for (const match of text.matchAll(/\b(Approval|Channel|Group|Media|Policy|Post|Publishing|Scheduling) > ([A-Z][A-Za-z ]*)/g)) {
			checked++;
			const known = operationsOf.get(resourceNames.get(match[1])!) ?? [];
			assert.ok(
				known.some((name) => match[2].startsWith(name)),
				`${match[0]} in "${text}"`,
			);
		}
	}
	assert.ok(checked >= 5);
	assert.equal(strings.some((text) => /List Options|Import Media From URL/.test(text)), false);
	const board = findV2('options', 'post').options.find((o: any) => o.name === 'platformSettings').options.find(
		(o: any) => o.name === 'pinterestBoard',
	);
	assert.match(board.description, /Channel > Get Options/);
});

// ---- C23 ----

test('C23. referenced fields are quoted in descriptions and error messages', async () => {
	const options = findV2('options', 'post');
	const wait = options.options.find((o: any) => o.name === 'waitTimeout');
	assert.match(wait.description, /'Wait for Result'/);
	const update = findV2('updateFields').options.find((o: any) => o.name === 'settingsJson');
	assert.match(update.description, /'Platform Settings'/);
	const failing = async (params: Record<string, unknown>, responses: unknown[] = []) => {
		const { context } = makeFakeContext(params, responses);
		return executeV2.call(context).then(
			() => undefined,
			(e: unknown) => (e as Error).message,
		);
	};
	const integrations = [{ id: 'c1', name: 'X', identifier: 'x' }];
	const base = { resource: 'post', operation: 'publish', channels: ['c1'], text: '', when: 'draft', mediaSource: 'none', options: {} };
	assert.match(String(await failing(base, [integrations])), /Set 'Text' or add 'Media'\./);
	const yt = [{ id: 'y1', name: 'YT', identifier: 'youtube' }];
	assert.match(
		String(await failing({ ...base, channels: ['y1'], text: 'x' }, [yt])),
		/Set 'Options' > 'Platform Settings' > 'Title'\./,
	);
	assert.match(
		String(await failing({ resource: 'post', operation: 'update', postId: 'p', updateFields: { text: 'x' }, updateMediaSource: 'uploaded', updateMediaJson: '[]' })),
		/'Media JSON' is empty.*choose 'Remove All Media'/,
	);
	assert.match(String(await failing({ resource: 'post', operation: 'check', text: '', platforms: ['x'] })), /^'Text' is required/);
	assert.match(String(await failing({ resource: 'channel', operation: 'getRules' })), /^'Channel' is required/);
	assert.match(
		String(await failing({ resource: 'post', operation: 'getMany', range: 'custom' })),
		/'Start Date' and 'End Date'/,
	);
	assert.match(String(await failing({ ...base, channels: [], text: 'x' }, [integrations])), /^'Channel Names or IDs' must list/);
	assert.match(
		String(await failing({ ...base, text: 'x', mediaSource: 'binary', binaryProperties: ' ' }, [integrations])),
		/^'Input Binary Field' must list/,
	);
});

// ---- C24 ----

test('C24. List Inputs names its key "Field Name" and keeps the parameter name', () => {
	const inputs = findV2('toolData');
	const key = inputs.options[0].values[0];
	assert.equal(key.displayName, 'Field Name');
	assert.equal(key.name, 'key');
});

// ---- C25 ----

test('C25. Group Rename and Archive exist in version 1 only, with a text field', async () => {
	assert.equal(v2Properties.filter((p) => p.name === 'targetGroupId').length, 0);
	assert.equal(v2Properties.filter((p) => p.name === 'groupName').length, 0);
	assert.equal(typeof (new PostSider().methods.loadOptions as Record<string, unknown>).getGroupChoices, 'undefined');
	const v1 = fieldProperties.find((p) => p.name === 'targetGroupId') as INodeProperties;
	assert.equal(v1.type, 'string');
	assert.deepEqual(v1.displayOptions?.show?.['@version'], [1]);
	// version 1 still reads the group and names it 'Group ID' in the error
	const v1Missing = makeFakeContext({ resource: 'group', operation: 'archive', targetGroupId: '' }, [], { typeVersion: 1 });
	await assert.rejects(() => new PostSider().execute.call(v1Missing.context), /'Group ID' is required/);
	const v1Rename = makeFakeContext(
		{ resource: 'group', operation: 'update', targetGroupId: 'grp 1', groupName: 'New' },
		[{ id: 'grp 1' }],
		{ typeVersion: 1 },
	);
	await new PostSider().execute.call(v1Rename.context);
	assert.equal(v1Rename.requests[0].url, 'https://api.postsider.com/public/v1/customers/grp%201');
});

// ---- C26 ----

test('C26. the credential documentation URL points to the authentication page', () => {
	assert.equal(new PostSiderApi().documentationUrl, 'https://docs.postsider.com/security/authentication');
});

// ---- D: guard against optional fields drifting back to the top level ----

/**
 * UX rule: an optional field belongs in a "Filters", "Options" or "Additional Fields" collection. Top-level
 * fields that are not required must be listed here, each with the reason it stays visible. Fields that only
 * show after another field is set (for example the binary field name once Media is Binary Data) depend on
 * a required choice and are not checked.
 */
const TOP_LEVEL_ALLOWLIST: Record<string, string[]> = {
	'channel.getAnalytics': ['days'],
	'media.getMany': ['returnAll'],
	'media.upload': ['uploadSource'],
	'post.changeStatus': ['status'],
	'post.get': ['simplify'],
	'post.getAnalytics': ['days'],
	'post.getMany': ['simplify', 'range', 'returnAll'],
	'post.publish': ['text', 'when', 'mediaSource'],
	'post.update': ['updateMediaSource'],
};

test('D. no optional field is shown at the top level of a version 2 operation except the allowlist', () => {
	let operations = 0;
	let fields = 0;
	for (const operation of v2Operations) {
		const resource = (operation.displayOptions?.show?.resource as string[])[0];
		for (const option of operation.options as any[]) {
			operations++;
			const key = `${resource}.${option.value}`;
			const allowed = TOP_LEVEL_ALLOWLIST[key] ?? [];
			const shown = v2Properties.filter((p) => {
				if (p.name === 'resource' || p.name === 'operation') return false;
				const show = p.displayOptions?.show as Record<string, unknown[]>;
				return show.resource?.includes(resource) && show.operation?.includes(option.value);
			});
			const unexpected: string[] = [];
			for (const property of shown) {
				fields++;
				const show = property.displayOptions?.show as Record<string, unknown[]>;
				const dependsOnAnotherField = Object.keys(show).some(
					(name) => !['@version', 'resource', 'operation'].includes(name),
				);
				if (property.required || dependsOnAnotherField) continue;
				if (['collection', 'fixedCollection'].includes(property.type)) continue;
				if (!allowed.includes(property.name)) unexpected.push(property.name);
			}
			assert.deepEqual(unexpected, [], `${key} shows optional fields at the top level`);
		}
	}
	assert.equal(operations, 26);
	assert.ok(fields > 40);
	// every allowlist entry is real, so a removed field cannot stay allowed by accident
	for (const [key, names] of Object.entries(TOP_LEVEL_ALLOWLIST)) {
		const [resource, operation] = key.split('.');
		for (const name of names) {
			const exists = v2Properties.some((p) => {
				const show = p.displayOptions?.show as Record<string, unknown[]>;
				return p.name === name && show.resource?.includes(resource) && show.operation?.includes(operation);
			});
			assert.ok(exists, `${key}.${name}`);
		}
	}
});
