/* eslint-disable @n8n/community-nodes/no-restricted-imports */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildRequestOptions,
	normalizeApiBaseUrl,
} from '../nodes/PostSider/shared/transport.ts';

test('normalizeApiBaseUrl accepts HTTPS and local HTTP without duplicating public API path', () => {
	assert.equal(normalizeApiBaseUrl('https://api.postsider.com/'), 'https://api.postsider.com/public/v1');
	assert.equal(
		normalizeApiBaseUrl('https://social.example.com/api/public/v1/'),
		'https://social.example.com/api/public/v1',
	);
	assert.equal(
		normalizeApiBaseUrl('http://localhost:3000/api'),
		'http://localhost:3000/api/public/v1',
	);
});

test('normalizeApiBaseUrl rejects insecure remote URLs and embedded credentials', () => {
	assert.throws(() => normalizeApiBaseUrl('http://example.com/api'), /must use HTTPS/);
	assert.throws(() => normalizeApiBaseUrl('https://user:pass@example.com/api'), /must not include credentials/);
});

test('buildRequestOptions refuses redirects and omits body for GET requests', () => {
	assert.deepEqual(buildRequestOptions('GET', 'https://api.postsider.com/public/v1/groups'), {
		method: 'GET',
		url: 'https://api.postsider.com/public/v1/groups',
		json: true,
		timeout: 30000,
		disableFollowRedirect: true,
		sendCredentialsOnCrossOriginRedirect: false,
	});
});

test('buildRequestOptions includes JSON body, query string, and explicit headers', () => {
	const body = { url: 'https://cdn.example/photo.png' };
	assert.deepEqual(
		buildRequestOptions('POST', 'https://api.postsider.com/public/v1/upload-from-url', {
			body,
			qs: { group: 'group_1' },
			headers: { 'Idempotency-Key': 'n8n.execution_1.item_0' },
		}),
		{
			method: 'POST',
			url: 'https://api.postsider.com/public/v1/upload-from-url',
			body,
			qs: { group: 'group_1' },
			headers: { 'Idempotency-Key': 'n8n.execution_1.item_0' },
			json: true,
			timeout: 30000,
			disableFollowRedirect: true,
			sendCredentialsOnCrossOriginRedirect: false,
		},
	);
});
