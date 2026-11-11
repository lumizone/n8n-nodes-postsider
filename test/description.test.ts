/* eslint-disable @n8n/community-nodes/no-restricted-imports */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { PostSiderApi } from '../credentials/PostSiderApi.credentials.ts';
import { PostSider } from '../nodes/PostSider/PostSider.node.ts';

const node = new PostSider();
const isV1 = (property: { displayOptions?: { show?: Record<string, unknown> } }) =>
	JSON.stringify(property.displayOptions?.show?.['@version']) === '[1]';
const credential = new PostSiderApi();

test('credential stores the API key as a secret and tests the connection declaratively', () => {
	const apiKey = credential.properties.find((property) => property.name === 'apiKey');
	assert.equal(apiKey?.typeOptions?.password, true);
	assert.deepEqual(credential.authenticate.properties.headers, {
		Authorization: '={{$credentials.apiKey}}',
	});
	assert.equal(node.description.credentials?.[0].testedBy, undefined);
	assert.equal(node.methods?.credentialTest, undefined);
});

function resolveTestBaseUrl(baseUrl: string): string {
	const expression = String(credential.test.request.baseURL);
	assert.ok(expression.startsWith('={{') && expression.endsWith('}}'));
	return runInNewContext(expression.slice(3, -2), { $credentials: { baseUrl } }) as string;
}

test('credential test calls GET /is-connected on the normalized base URL', () => {
	assert.equal(credential.test.request.url, '/is-connected');
	assert.equal(credential.test.request.method, 'GET');
	assert.equal(resolveTestBaseUrl('https://api.postsider.com'), 'https://api.postsider.com/public/v1');
	assert.equal(resolveTestBaseUrl('https://api.postsider.com/'), 'https://api.postsider.com/public/v1');
	assert.equal(
		resolveTestBaseUrl('https://social.example.com/api/'),
		'https://social.example.com/api/public/v1',
	);
	assert.equal(
		resolveTestBaseUrl('https://social.example.com/api/public/v1/'),
		'https://social.example.com/api/public/v1',
	);
});

test('node and credential declare light and dark icons', () => {
	assert.deepEqual(node.description.icon, {
		light: 'file:postsider.svg',
		dark: 'file:postsider.dark.svg',
	});
	assert.deepEqual(credential.icon, {
		light: 'file:../nodes/PostSider/postsider.svg',
		dark: 'file:../nodes/PostSider/postsider.dark.svg',
	});
});

test('node exposes the reviewed MVP resources and is usable as an AI tool', () => {
	assert.equal(node.description.usableAsTool, true);
	const resource = node.description.properties.find(
		(property) => property.name === 'resource' && isV1(property),
	);
	const values = (resource?.options ?? []).map((option) => ('value' in option ? option.value : null));
	assert.deepEqual(values, ['approval', 'channel', 'group', 'media', 'policy', 'post', 'scheduling']);
});

test('node exposes only the reviewed operations', () => {
	const operationProperties = node.description.properties.filter(
		(property) => property.name === 'operation' && isV1(property),
	);
	const byResource = Object.fromEntries(
		operationProperties.map((property) => [
			(property.displayOptions?.show?.resource as string[])[0],
			(property.options ?? []).map((option) => ('value' in option ? option.value : null)),
		]),
	);
	assert.deepEqual(byResource.approval, ['approve', 'getMany', 'getStatus', 'reject', 'request']);
	assert.deepEqual(byResource.policy, ['check', 'getMany']);
	assert.deepEqual(byResource.group, ['archive', 'create', 'getMany', 'update']);
});

test('new operations expose their fields only for the right resource and operation', () => {
	const find = (name: string) =>
		collectProperties(node.description.properties).find((property) => property.name === name);
	assert.deepEqual(find('approvalId')?.displayOptions?.show, {
		'@version': [1],
		resource: ['approval'],
		operation: ['approve', 'reject'],
	});
	assert.deepEqual(find('note')?.displayOptions?.show, {
		'@version': [1],
		resource: ['approval'],
		operation: ['approve', 'reject'],
	});
	assert.deepEqual(find('postId')?.displayOptions?.show?.operation, ['get', 'getStatus', 'request']);
	assert.deepEqual(find('targetGroupId')?.displayOptions?.show, {
		'@version': [1],
		resource: ['group'],
		operation: ['update', 'archive'],
	});
	assert.deepEqual(find('groupName')?.displayOptions?.show, {
		'@version': [1],
		resource: ['group'],
		operation: ['create', 'update'],
	});
	assert.deepEqual(find('policyChannelPosts')?.displayOptions?.show, {
		'@version': [1],
		resource: ['policy'],
		operation: ['check'],
	});
	assert.deepEqual(find('limit')?.displayOptions?.show?.returnAll, [false]);
	assert.equal(find('approvalStatus')?.default, 'PENDING');
});

test('approve and reject descriptions name the required scope', () => {
	const approval = node.description.properties.find(
		(property) =>
			property.name === 'operation' &&
			isV1(property) &&
			(property.displayOptions?.show?.resource as string[])[0] === 'approval',
	);
	for (const value of ['approve', 'reject']) {
		const option = (approval?.options ?? []).find((entry) => 'value' in entry && entry.value === value);
		assert.match(String(option?.description), /approvals:decide/);
	}
});

test('node exposes only safe MVP operations', () => {
	const operationProperties = node.description.properties.filter(
		(property) => property.name === 'operation' && isV1(property),
	);
	const operations = operationProperties.flatMap((property) =>
		(property.options ?? []).map((option) => ('value' in option ? option.value : null)),
	);
	assert.ok(operations.includes('create'));
	assert.ok(operations.includes('get'));
	assert.ok(operations.includes('getMany'));
	assert.ok(operations.includes('findNextSlot'));
	assert.ok(operations.includes('request'));
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
		'@version': [1],
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
