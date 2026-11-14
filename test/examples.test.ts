/* eslint-disable @n8n/community-nodes/no-restricted-imports */
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type { INodeProperties, INodePropertyCollection, INodePropertyOptions } from 'n8n-workflow';

import { PostSider } from '../nodes/PostSider/PostSider.node.ts';
import { PostSiderTrigger } from '../nodes/PostSiderTrigger/PostSiderTrigger.node.ts';

import draftWorkflow from '../examples/import-media-and-create-draft.json';
import scheduleWorkflow from '../examples/find-slot-and-schedule.json';
import approvalWorkflow from '../examples/approval-notify-slack.json';
import publishNowWorkflow from '../examples/publish-now-with-image.json';
import failedPostWorkflow from '../examples/notify-on-failed-post.json';

const POSTSIDER = 'n8n-nodes-postsider.postSider';
const TRIGGER = 'n8n-nodes-postsider.postSiderTrigger';
const examplesDir = path.join(import.meta.dirname, '..', 'examples');
const allWorkflows = [draftWorkflow, scheduleWorkflow, approvalWorkflow, publishNowWorkflow, failedPostWorkflow];

type ExampleNode = {
	name: string;
	type: string;
	typeVersion: number;
	parameters: Record<string, unknown>;
	credentials?: Record<string, { id: string; name: string }>;
	disabled?: boolean;
};

const nodesOf = (workflow: { nodes: unknown[] }) => workflow.nodes as ExampleNode[];

test('every file in examples/ is covered by these tests', () => {
	const files = readdirSync(examplesDir).filter((file) => file.endsWith('.json'));
	assert.equal(files.length, allWorkflows.length, files.join(', '));
});

// ---------------------------------------------------------------------------------------------
// Parameter validation against the node descriptions
// ---------------------------------------------------------------------------------------------

type Show = Record<string, unknown[]>;

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A property is visible for a node when every `show` condition on `@version`, `resource` and
 * `operation` holds. Conditions on other parameters (for example `when`) are checked against the
 * parameters of the example node, falling back to the property default.
 */
function isVisible(property: INodeProperties, node: ExampleNode): boolean {
	const show = (property.displayOptions?.show ?? {}) as Show;
	for (const [key, allowed] of Object.entries(show)) {
		const actual = key === '@version' ? node.typeVersion : node.parameters[key];
		if (actual === undefined) {
			// not set in the example: the node uses the default of the controlling property
			const controlling = key === '@version' ? undefined : defaultOf(key, node);
			if (controlling === undefined && key !== '@version') return false;
			if (!allowed.includes(controlling)) return false;
		} else if (!allowed.includes(actual)) {
			return false;
		}
	}
	return true;
}

const descriptions = {
	[POSTSIDER]: new PostSider().description.properties,
	[TRIGGER]: new PostSiderTrigger().description.properties,
} as Record<string, INodeProperties[]>;

function defaultOf(name: string, node: ExampleNode): unknown {
	const candidates = descriptions[node.type].filter((property) => property.name === name);
	// The first visible candidate that does not itself depend on the property being resolved.
	for (const property of candidates) {
		const show = (property.displayOptions?.show ?? {}) as Show;
		const version = show['@version'];
		if (version && !version.includes(node.typeVersion)) continue;
		return property.default;
	}
	return undefined;
}

function checkValue(property: INodeProperties, value: unknown, where: string): void {
	if (property.type === 'options') {
		const allowed = (property.options as INodePropertyOptions[]).map((option) => option.value);
		assert.ok(
			allowed.includes(value as string),
			`${where}: '${String(value)}' is not an option of '${property.displayName}' (${allowed.join(', ')})`,
		);
	} else if (property.type === 'multiOptions' && !property.typeOptions?.loadOptionsMethod) {
		const allowed = (property.options as INodePropertyOptions[]).map((option) => option.value);
		assert.ok(Array.isArray(value), `${where}: expected an array`);
		for (const entry of value as string[]) {
			assert.ok(allowed.includes(entry), `${where}: '${entry}' is not allowed (${allowed.join(', ')})`);
		}
	} else if (property.type === 'multiOptions') {
		assert.ok(Array.isArray(value), `${where}: expected an array`);
	} else if (property.type === 'boolean') {
		assert.equal(typeof value, 'boolean', `${where}: expected a boolean`);
	} else if (property.type === 'number') {
		assert.equal(typeof value, 'number', `${where}: expected a number`);
	}
}

function checkCollection(property: INodeProperties, value: unknown, where: string): void {
	assert.ok(isObject(value), `${where}: expected an object`);
	if (property.type === 'collection') {
		const children = property.options as INodeProperties[];
		for (const [key, child] of Object.entries(value)) {
			const definition = children.find((option) => option.name === key);
			assert.ok(definition, `${where}.${key} is not a field of '${property.displayName}'`);
			checkProperty(definition, child, `${where}.${key}`);
		}
	} else if (property.type === 'fixedCollection') {
		const groups = property.options as INodePropertyCollection[];
		for (const [groupName, rows] of Object.entries(value)) {
			const group = groups.find((option) => option.name === groupName);
			assert.ok(group, `${where}.${groupName} is not a group of '${property.displayName}'`);
			for (const row of (Array.isArray(rows) ? rows : [rows]) as Record<string, unknown>[]) {
				for (const [key, child] of Object.entries(row)) {
					const definition = group.values.find((entry) => entry.name === key);
					assert.ok(definition, `${where}.${groupName}.${key} is not a field`);
					checkProperty(definition, child, `${where}.${groupName}.${key}`);
				}
			}
		}
	}
}

function checkProperty(property: INodeProperties, value: unknown, where: string): void {
	// Expressions are accepted for every type; their result cannot be checked statically.
	if (typeof value === 'string' && value.startsWith('=')) return;
	if (property.type === 'collection' || property.type === 'fixedCollection') {
		checkCollection(property, value, where);
	} else {
		checkValue(property, value, where);
	}
}

function validateNodeParameters(node: ExampleNode): void {
	const properties = descriptions[node.type];
	const where = `${node.name} (${node.type} v${node.typeVersion})`;
	for (const [name, value] of Object.entries(node.parameters)) {
		// polling nodes get a pollTimes parameter from n8n itself
		if (node.type === TRIGGER && name === 'pollTimes') continue;
		const matches = properties.filter((property) => property.name === name);
		assert.ok(matches.length > 0, `${where}: unknown parameter '${name}'`);
		const visible = matches.filter((property) => isVisible(property, node));
		assert.ok(
			visible.length > 0,
			`${where}: parameter '${name}' is not shown for resource '${String(node.parameters.resource)}' operation '${String(node.parameters.operation)}'`,
		);
		checkProperty(visible[0], value, `${where}.${name}`);
	}
	// every required visible property must be set (or have a default that is not empty)
	for (const property of properties) {
		if (!property.required || !isVisible(property, node)) continue;
		assert.ok(
			property.name in node.parameters || property.default !== '',
			`${where}: required parameter '${property.name}' is missing`,
		);
	}
}

test('every PostSider node in the examples validates against the node description', () => {
	let checked = 0;
	for (const workflow of allWorkflows) {
		for (const node of nodesOf(workflow)) {
			if (node.type !== POSTSIDER && node.type !== TRIGGER) continue;
			validateNodeParameters(node);
			checked++;
		}
	}
	assert.ok(checked >= 5, `only ${checked} nodes were checked`);
});

test('the validator rejects an unknown parameter and a field outside its collection', () => {
	const base: ExampleNode = {
		name: 'Probe',
		type: POSTSIDER,
		typeVersion: 2,
		parameters: { resource: 'approval', operation: 'getMany' },
	};
	assert.throws(() => validateNodeParameters({ ...base, parameters: { ...base.parameters, status: 'PENDING' } }));
	assert.throws(() =>
		validateNodeParameters({ ...base, parameters: { ...base.parameters, approvalFilters: { note: 'x' } } }),
	);
	assert.throws(() =>
		validateNodeParameters({ ...base, parameters: { ...base.parameters, approvalFilters: { status: 'OPEN' } } }),
	);
	assert.doesNotThrow(() =>
		validateNodeParameters({ ...base, parameters: { ...base.parameters, approvalFilters: { status: 'PENDING' } } }),
	);
});

test('every PostSider node uses version 2 and the trigger uses version 1', () => {
	for (const workflow of allWorkflows) {
		for (const node of nodesOf(workflow)) {
			if (node.type === POSTSIDER) assert.equal(node.typeVersion, 2, node.name);
			if (node.type === TRIGGER) assert.equal(node.typeVersion, 1, node.name);
		}
	}
});

test('every example is inactive and only references credentials by name', () => {
	for (const workflow of allWorkflows) {
		assert.equal(workflow.active, false);
		for (const node of nodesOf(workflow)) {
			for (const reference of Object.values(node.credentials ?? {})) {
				assert.equal(reference.id, '');
				assert.match(reference.name, /account$/);
			}
		}
	}
});

test('examples need no environment access and no Code node', () => {
	for (const workflow of allWorkflows) {
		const text = JSON.stringify(workflow);
		assert.doesNotMatch(text, /\$env|process\.env|require\(/);
		for (const node of nodesOf(workflow)) assert.notEqual(node.type, 'n8n-nodes-base.code', node.name);
	}
});

test('examples hold no secret-like strings and no em or en dashes', () => {
	for (const workflow of allWorkflows) {
		const text = JSON.stringify(workflow);
		assert.doesNotMatch(text, /hooks\.slack\.com/);
		assert.doesNotMatch(text, /sk_[A-Za-z0-9]{8,}|xox[a-z]-|Bearer\s+[A-Za-z0-9]/);
		assert.doesNotMatch(text, /"(apiKey|secret|token|password)"\s*:\s*"[^"]/i);
		assert.doesNotMatch(text, /[\u2013\u2014]/);
	}
});

// ---------------------------------------------------------------------------------------------
// What each example does
// ---------------------------------------------------------------------------------------------

test('schedule example publishes into the next free slot and never publishes now', () => {
	const node = nodesOf(scheduleWorkflow).find((n) => n.type === POSTSIDER);
	assert.ok(node);
	assert.equal(node.parameters.operation, 'publish');
	assert.equal(node.parameters.when, 'nextSlot');
	assert.equal('idempotencyKey' in (node.parameters.options as object), false);
});

test('draft example imports a public URL with a supported extension and saves a draft', () => {
	const node = nodesOf(draftWorkflow).find((n) => n.type === POSTSIDER);
	assert.ok(node);
	assert.equal(node.parameters.when, 'draft');
	assert.equal(node.parameters.mediaSource, 'url');
	assert.match(String(node.parameters.mediaUrls), /^https:\/\/\S+\.(png|jpg|jpeg|gif|webp|mp4|webm|mov)$/);
});

test('approval example lists pending approvals and sends them to Slack without deciding anything', () => {
	const types = nodesOf(approvalWorkflow).map((n) => n.type);
	assert.deepEqual(
		[...types].sort(),
		[
			'n8n-nodes-base.scheduleTrigger',
			'n8n-nodes-base.slack',
			'n8n-nodes-base.stickyNote',
			POSTSIDER,
		].sort(),
	);
	const node = nodesOf(approvalWorkflow).find((n) => n.type === POSTSIDER);
	assert.ok(node);
	assert.equal(node.parameters.resource, 'approval');
	assert.equal(node.parameters.operation, 'getMany');
	assert.deepEqual(node.parameters.approvalFilters, { status: 'PENDING' });
});

test('approval example Slack text only uses fields the approvals API returns', () => {
	const slack = nodesOf(approvalWorkflow).find((n) => n.type === 'n8n-nodes-base.slack');
	const text = String(slack?.parameters.text);
	const returned = new Set(['id', 'postId', 'requestedAt', 'channel', 'stage']);
	const used = [...text.matchAll(/\$json\.(\w+)/g)].map((match) => match[1]);
	assert.ok(used.length > 0);
	for (const field of used) assert.ok(returned.has(field), field);
});

test('publish-now example uses binary media and waits for the result', () => {
	const node = nodesOf(publishNowWorkflow).find((n) => n.type === POSTSIDER);
	assert.ok(node);
	assert.equal(node.parameters.operation, 'publish');
	assert.equal(node.parameters.when, 'now');
	assert.equal(node.parameters.mediaSource, 'binary');
	assert.equal((node.parameters.options as { waitForResult?: boolean }).waitForResult, true);
});

test('failed-post example triggers on failed posts and uses generic nodes only', () => {
	const trigger = nodesOf(failedPostWorkflow).find((n) => n.type === TRIGGER);
	assert.ok(trigger);
	assert.deepEqual(trigger.parameters.events, ['failed']);
	for (const node of nodesOf(failedPostWorkflow)) {
		assert.match(node.type, /^n8n-nodes-(base|postsider)\./);
	}
});
