/* eslint-disable @n8n/community-nodes/no-restricted-imports */
import assert from 'node:assert/strict';
import test from 'node:test';

import { PostSiderApi } from '../credentials/PostSiderApi.credentials.ts';
import { PostSider } from '../nodes/PostSider/PostSider.node.ts';

const node = new PostSider();
const credential = new PostSiderApi();

test('credential stores the API key as a secret and delegates testing to the hardened node method', () => {
	const apiKey = credential.properties.find((property) => property.name === 'apiKey');
	assert.equal(apiKey?.typeOptions?.password, true);
	assert.deepEqual(credential.authenticate.properties.headers, {
		Authorization: '={{$credentials.apiKey}}',
	});
	assert.equal(credential.test, undefined);
	assert.equal(node.description.credentials?.[0].testedBy, 'postSiderCredentialTest');
});

test('node exposes the reviewed MVP resources and is usable as an AI tool', () => {
	assert.equal(node.description.usableAsTool, true);
	const resource = node.description.properties.find((property) => property.name === 'resource');
	const values = (resource?.options ?? []).map((option) => ('value' in option ? option.value : null));
	assert.deepEqual(values, ['approval', 'channel', 'group', 'media', 'post', 'scheduling']);
});

test('node exposes only safe MVP operations', () => {
	const operationProperties = node.description.properties.filter(
		(property) => property.name === 'operation',
	);
	const operations = operationProperties.flatMap((property) =>
		(property.options ?? []).map((option) => ('value' in option ? option.value : null)),
	);
	assert.ok(operations.includes('create'));
	assert.ok(operations.includes('get'));
	assert.ok(operations.includes('getMany'));
	assert.ok(operations.includes('findNextSlot'));
	assert.equal(operations.includes('request'), false);
	assert.ok(operations.includes('getStatus'));
	assert.ok(operations.includes('importFromUrl'));
	assert.equal(operations.includes('delete'), false);
	assert.equal(operations.includes('publishNow'), false);
	assert.equal(operations.includes('pausePublishing'), false);
});

test('create post defaults to draft and exposes schedule date only for schedules', () => {
	const type = node.description.properties.find((property) => property.name === 'type');
	assert.equal(type?.default, 'draft');
	const publishDate = node.description.properties.find(
		(property) => property.name === 'publishDate',
	);
	assert.deepEqual(publishDate?.displayOptions?.show, {
		resource: ['post'],
		operation: ['create'],
		type: ['schedule'],
	});
});

function collectProperties(properties: typeof node.description.properties): typeof node.description.properties {
	const nested = properties.flatMap((property) => {
		const directValues = 'values' in property && Array.isArray(property.values) ? property.values : [];
		const optionValues = (property.options ?? []).flatMap((option) =>
			'values' in option && Array.isArray(option.values) ? option.values : [],
		);
		return collectProperties([...directValues, ...optionValues]);
	});
	return [...properties, ...nested];
}

test('dynamic channel and group selectors are wired to load-options methods', () => {
	const properties = collectProperties(node.description.properties);
	const channelFields = properties.filter((property) => property.name === 'channelId');
	assert.ok(channelFields.length >= 2);
	for (const field of channelFields) {
		assert.equal(field.typeOptions?.loadOptionsMethod, 'getChannels');
	}
	const groupFields = properties.filter((property) => property.name === 'groupId');
	assert.ok(groupFields.length >= 2);
	for (const field of groupFields) {
		assert.equal(field.typeOptions?.loadOptionsMethod, 'getGroups');
	}
});
