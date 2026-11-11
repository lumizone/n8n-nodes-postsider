/* eslint-disable @n8n/community-nodes/no-restricted-imports */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildRequestOptions,
	normalizeApiBaseUrl,
} from '../nodes/PostSider/shared/transport.ts';
import { testNode } from './helpers.ts';

test('normalizeApiBaseUrl accepts HTTPS and local HTTP without duplicating public API path', () => {
	assert.equal(normalizeApiBaseUrl(testNode, 'https://api.postsider.com/'), 'https://api.postsider.com/public/v1');
	assert.equal(
		normalizeApiBaseUrl(testNode, 'https://social.example.com/api/public/v1/'),
		'https://social.example.com/api/public/v1',
	);
	assert.equal(
		normalizeApiBaseUrl(testNode, 'http://localhost:3000/api'),
		'http://localhost:3000/api/public/v1',
	);
});

test('normalizeApiBaseUrl rejects insecure remote URLs and embedded credentials', () => {
	assert.throws(() => normalizeApiBaseUrl(testNode, 'http://example.com/api'), /must use HTTPS/);
	assert.throws(() => normalizeApiBaseUrl(testNode, 'https://user:pass@example.com/api'), /must not include credentials/);
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

const requestIdentifier = ['n8n', 'execution_1', 'item_0'].join('.');

test('buildRequestOptions includes JSON body, query string, and explicit headers', () => {
	const body = { url: 'https://cdn.example/photo.png' };
	assert.deepEqual(
		buildRequestOptions('POST', 'https://api.postsider.com/public/v1/upload-from-url', {
			body,
			qs: { group: 'group_1' },
			headers: { 'Idempotency-Key': requestIdentifier },
		}),
		{
			method: 'POST',
			url: 'https://api.postsider.com/public/v1/upload-from-url',
			body,
			qs: { group: 'group_1' },
			headers: { 'Idempotency-Key': requestIdentifier },
			json: true,
			timeout: 30000,
			disableFollowRedirect: true,
			sendCredentialsOnCrossOriginRedirect: false,
		},
	);
});

test('buildRequestOptions sends multipart FormData as body without json or content type', () => {
	const formData = new FormData();
	formData.append('file', new Blob(['x'], { type: 'image/png' }), 'a.png');
	const options = buildRequestOptions('POST', 'https://api.postsider.com/public/v1/upload', {
		formData,
		timeout: 120000,
	});
	assert.equal(options.body, formData);
	assert.equal('json' in options, false);
	assert.equal(options.headers, undefined);
	assert.equal(options.timeout, 120000);
	assert.equal(options.disableFollowRedirect, true);
});
