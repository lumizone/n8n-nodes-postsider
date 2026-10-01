/* eslint-disable @n8n/community-nodes/no-restricted-imports */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ICredentialTestFunctions } from 'n8n-workflow';

import { postSiderCredentialTest } from '../nodes/PostSider/methods/credentialTest.ts';

function credential(value: { apiKey: string; baseUrl: string }) {
	return { data: value } as Parameters<typeof postSiderCredentialTest>[0];
}

test('credential test rejects an insecure remote URL before sending the API key', async () => {
	let requestCount = 0;
	const context = {
		helpers: {
			request: async () => {
				requestCount++;
			},
		},
	} as unknown as ICredentialTestFunctions;

	const result = await postSiderCredentialTest.call(
		context,
		credential({ apiKey: 'secret', baseUrl: 'http://example.com/api' }),
	);
	assert.equal(result.status, 'Error');
	assert.match(result.message, /must use HTTPS/);
	assert.equal(requestCount, 0);
});

test('credential test rejects embedded credentials before sending the API key', async () => {
	let requestCount = 0;
	const context = {
		helpers: {
			request: async () => {
				requestCount++;
			},
		},
	} as unknown as ICredentialTestFunctions;

	const result = await postSiderCredentialTest.call(
		context,
		credential({ apiKey: 'secret', baseUrl: 'https://user:pass@example.com/api' }),
	);
	assert.equal(result.status, 'Error');
	assert.match(result.message, /must not include credentials/);
	assert.equal(requestCount, 0);
});

test('credential test normalizes the URL, disables redirects, and authenticates with the raw key', async () => {
	let options: Record<string, unknown> | undefined;
	const context = {
		helpers: {
			request: async (received: Record<string, unknown>) => {
				options = received;
				return { id: 'org_1', name: 'PostSider' };
			},
		},
	} as unknown as ICredentialTestFunctions;

	const result = await postSiderCredentialTest.call(
		context,
		credential({ apiKey: 'raw-key', baseUrl: 'https://social.example.com/api/' }),
	);
	assert.deepEqual(result, { status: 'OK', message: 'Connection successful' });
	assert.deepEqual(options, {
		method: 'GET',
		uri: 'https://social.example.com/api/public/v1/is-connected',
		headers: { Authorization: 'raw-key' },
		json: true,
		timeout: 30000,
		followRedirect: false,
		followAllRedirects: false,
	});
});

test('credential test returns a safe error without exposing the API key', async () => {
	const context = {
		helpers: {
			request: async () => {
				throw new Error('Unauthorized raw-key');
			},
		},
	} as unknown as ICredentialTestFunctions;

	const result = await postSiderCredentialTest.call(
		context,
		credential({ apiKey: 'raw-key', baseUrl: 'https://api.postsider.com' }),
	);
	assert.equal(result.status, 'Error');
	assert.equal(result.message.includes('raw-key'), false);
});
