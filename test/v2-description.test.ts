/* eslint-disable @n8n/community-nodes/no-restricted-imports */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { INodeProperties } from 'n8n-workflow';

import { PostSider } from '../nodes/PostSider/PostSider.node.ts';
import { fieldProperties, operationProperties, resourceProperty } from '../nodes/PostSider/resources/descriptions.ts';
import { v2Properties } from '../nodes/PostSider/v2/descriptions.ts';

const { description } = new PostSider();
const SERVER_NOTE = 'Requires PostSider server 2026-11 or newer. ';

const v2Operation = (resource: string) =>
	v2Properties.find(
		(property) =>
			property.name === 'operation' &&
			(property.displayOptions?.show?.resource as string[])[0] === resource,
	) as INodeProperties;
const optionValues = (property: INodeProperties) =>
	(property.options ?? []).map((option) => ('value' in option ? option.value : null));

test('node declares versions 1 and 2 with default 2', () => {
	assert.deepEqual(description.version, [1, 2]);
	assert.equal(description.defaultVersion, 2);
});

test('every v1 property is hidden on version 2', () => {
	const v1 = [resourceProperty, ...operationProperties, ...fieldProperties];
	assert.equal(v1.length, 1 + 7 + fieldProperties.length);
	for (const property of v1) {
		assert.deepEqual(property.displayOptions?.show?.['@version'], [1], property.name);
	}
	// the 0.2.3 visibility rules are kept next to the version marker
	const rest = (property: INodeProperties) => {
		return Object.keys(property.displayOptions?.show ?? {}).filter((key) => key !== '@version');
	};
	assert.deepEqual(rest(resourceProperty), []);
	assert.deepEqual(rest(operationProperties[0]), ['resource']);
	const byName = Object.fromEntries(fieldProperties.map((property) => [property.name, rest(property)]));
	assert.deepEqual(byName.postId, ['resource', 'operation']);
	assert.deepEqual(byName.limit, ['resource', 'operation', 'returnAll']);
	assert.deepEqual(byName.publishDate, ['resource', 'operation', 'type']);
	assert.deepEqual(byName.url, ['resource', 'operation']);
});

test('every v2 property is shown only on version 2', () => {
	assert.ok(v2Properties.length > 0);
	for (const property of v2Properties) {
		assert.deepEqual(property.displayOptions?.show?.['@version'], [2], property.name);
	}
});

test('node properties list v1 first, then v2', () => {
	assert.equal(description.properties.length, 1 + 7 + fieldProperties.length + v2Properties.length);
	assert.equal(description.properties[0], resourceProperty);
});

test('v2 resources and operations match the reviewed surface', () => {
	const resource = v2Properties[0];
	assert.deepEqual(optionValues(resource), [
		'approval',
		'channel',
		'group',
		'media',
		'policy',
		'post',
		'publishing',
	]);
	assert.deepEqual(optionValues(v2Operation('post')), [
		'check',
		'delete',
		'duplicate',
		'get',
		'getAnalytics',
		'getMany',
		'publish',
		'retryFailed',
		'rewrite',
		'update',
	]);
	assert.deepEqual(optionValues(v2Operation('media')), ['delete', 'getMany', 'upload']);
	assert.deepEqual(optionValues(v2Operation('channel')), [
		'disable',
		'enable',
		'findNextSlot',
		'getAnalytics',
		'getMany',
		'getRules',
	]);
	assert.deepEqual(optionValues(v2Operation('publishing')), ['getState', 'pause']);
	assert.deepEqual(optionValues(v2Operation('approval')), [
		'approve',
		'getMany',
		'getStatus',
		'reject',
		'request',
	]);
	assert.deepEqual(optionValues(v2Operation('policy')), ['check', 'getMany']);
	assert.deepEqual(optionValues(v2Operation('group')), ['archive', 'create', 'getMany', 'update']);
});

test('v2 post resource defaults to publish and publish defaults to now', () => {
	assert.equal(v2Properties[0].default, 'post');
	assert.equal(v2Operation('post').default, 'publish');
	assert.equal(v2Operation('media').default, 'upload');
	assert.equal(v2Operation('channel').default, 'getMany');
	assert.equal(v2Operation('publishing').default, 'getState');
	const when = v2Properties.find((property) => property.name === 'when');
	assert.equal(when?.default, 'now');
	assert.deepEqual(optionValues(when as INodeProperties).sort(), ['draft', 'nextSlot', 'now', 'schedule']);
});

test('publish fields are wired to the publish operation only', () => {
	const find = (name: string) => v2Properties.find((property) => property.name === name);
	const publish = { '@version': [2], resource: ['post'], operation: ['publish'] };
	for (const name of ['channels', 'text', 'when', 'mediaSource', 'options']) {
		assert.deepEqual(find(name)?.displayOptions?.show, publish, name);
	}
	assert.equal(find('channels')?.type, 'multiOptions');
	assert.equal(find('channels')?.typeOptions?.loadOptionsMethod, 'getChannels');
	assert.deepEqual(find('date')?.displayOptions?.show, { ...publish, when: ['schedule'] });
	assert.deepEqual(find('binaryProperties')?.displayOptions?.show, { ...publish, mediaSource: ['binary'] });
	assert.equal(find('binaryProperties')?.default, 'data');
	assert.deepEqual(find('mediaUrls')?.displayOptions?.show, { ...publish, mediaSource: ['url'] });
	assert.deepEqual(find('mediaJson')?.displayOptions?.show, { ...publish, mediaSource: ['uploaded'] });
	assert.equal(find('mediaSource')?.default, 'none');
	assert.deepEqual(optionValues(find('mediaSource') as INodeProperties).sort(), [
		'binary',
		'none',
		'uploaded',
		'url',
	]);
});

test('publish options collection carries the optional fields', () => {
	const options = v2Properties.find((property) => property.name === 'options');
	assert.equal(options?.type, 'collection');
	const names = (options?.options ?? []).map((option) => ('name' in option ? option.name : null)).sort();
	assert.deepEqual(names, [
		'firstComment',
		'idempotencyKey',
		'perChannelText',
		'platformSettings',
		'settingsJson',
		'shortLink',
		'tags',
		'waitForResult',
		'waitTimeout',
	]);
	const get = (name: string) =>
		(options?.options ?? []).find((option) => 'name' in option && option.name === name) as INodeProperties;
	assert.equal(get('waitTimeout').default, 60);
	assert.equal(get('waitTimeout').typeOptions?.maxValue, 300);
	assert.equal(get('waitForResult').default, false);
	const override = get('perChannelText').options?.[0];
	assert.ok(override && 'values' in override);
	assert.equal(override.name, 'override');
	assert.deepEqual(
		(override.values as INodeProperties[]).map((value) => value.name),
		['channelId', 'text'],
	);
	const tag = get('tags').options?.[0];
	assert.ok(tag && 'values' in tag);
	assert.equal(tag.name, 'tag');
	assert.deepEqual(
		(tag.values as INodeProperties[]).map((value) => value.name).sort(),
		['label', 'value'],
	);
});

test('control-plane operations carry the server prefix', () => {
	const gated: Array<[string, string[] | null]> = [
		['approval', null],
		['policy', null],
		['group', null],
		['post', ['retryFailed']],
	];
	for (const [resource, only] of gated) {
		for (const option of v2Operation(resource).options ?? []) {
			if (!('value' in option)) continue;
			if (only && !only.includes(String(option.value))) continue;
			assert.ok(
				String(option.description).startsWith(SERVER_NOTE),
				`${resource}.${String(option.value)}`,
			);
		}
	}
	const publish = (v2Operation('post').options ?? []).find(
		(option) => 'value' in option && option.value === 'publish',
	);
	assert.equal(String(publish?.description).startsWith(SERVER_NOTE), false);
});

test('every v2 operation has an action and a description', () => {
	for (const property of v2Properties.filter((entry) => entry.name === 'operation')) {
		for (const option of property.options ?? []) {
			assert.ok('action' in option && String(option.action).length > 0, String('value' in option && option.value));
			assert.ok(String(option.description).length > 10, String('value' in option && option.value));
		}
	}
});
