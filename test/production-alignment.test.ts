/* eslint-disable @n8n/community-nodes/no-restricted-imports, @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { fieldProperties } from '../nodes/PostSider/resources/descriptions';
import { simplifyPostResponse } from '../nodes/PostSider/shared/operations';
import { v2Properties } from '../nodes/PostSider/v2/descriptions';
import { shapePostOutput } from '../nodes/PostSider/v2/postOperations';
import { newestMatching, selectNewPosts } from '../nodes/PostSiderTrigger/poll';

// ---- error and errorCode in posts ----

const failedRow = {
	id: '1',
	state: 'ERROR',
	publishDate: '2026-11-10T10:00:00.000Z',
	error: 'Token expired',
	errorCode: 'AUTH_EXPIRED',
	content: 'text',
	integration: { id: 'c1', name: 'Ch', providerIdentifier: 'x', token: 'secret-token' },
};

test('the trigger output carries error and errorCode of a failed post', () => {
	const out = selectNewPosts([failedRow], ['failed'], [], []).emit[0];
	assert.equal(out.error, 'Token expired');
	assert.equal(out.errorCode, 'AUTH_EXPIRED');
	assert.equal(out.event, 'failed');
	const manual = newestMatching([failedRow], ['failed'], [])[0];
	assert.equal(manual.errorCode, 'AUTH_EXPIRED');
	assert.doesNotMatch(JSON.stringify(out), /secret-token/);
});

test('the trigger output has no errorCode for a post that has none', () => {
	const out = selectNewPosts(
		[{ id: '2', state: 'PUBLISHED', publishDate: 'x', integration: { id: 'c1' } }],
		['published'],
		[],
		[],
	).emit[0];
	assert.equal('errorCode' in out, false);
	assert.equal('error' in out, false);
});

test('simplified posts keep error and errorCode and still flatten the channel', () => {
	const simple = simplifyPostResponse(failedRow);
	assert.equal(simple.error, 'Token expired');
	assert.equal(simple.errorCode, 'AUTH_EXPIRED');
	assert.equal(simple.integrationId, 'c1');
	assert.equal('integration' in simple, false);
	assert.equal('token' in simple, false);
	assert.equal('error' in simplifyPostResponse({ id: '3', state: 'QUEUE' }), false);
	// Post > Get Many returns the simplified rows
	const rows = shapePostOutput('getMany', { posts: [failedRow] }, { simplify: true, returnAll: true });
	assert.equal(rows[0].errorCode, 'AUTH_EXPIRED');
	assert.equal(rows[0].error, 'Token expired');
	assert.doesNotMatch(JSON.stringify(rows), /secret-token/);
});

// ---- idempotency key wording ----

const KEY_TEXT = /remembers a key permanently for your organization\. Reusing it returns the first result, or fails if the request is different/;

test('the Idempotency Key fields of version 1 and version 2 say that keys are kept permanently', () => {
	const v1 = fieldProperties.find((p) => p.name === 'idempotencyKey') as any;
	assert.match(v1.description, KEY_TEXT);
	const options = v2Properties.find((p) => p.name === 'options' && (p.displayOptions?.show as any)?.operation?.includes('publish')) as any;
	const v2 = options.options.find((o: any) => o.name === 'idempotencyKey');
	assert.match(v2.description, KEY_TEXT);
});

test('no source file or description says that keys are kept for a number of days', () => {
	const root = path.join(import.meta.dirname, '..');
	const idempotency = readFileSync(path.join(root, 'nodes/PostSider/shared/idempotency.ts'), 'utf8');
	assert.doesNotMatch(idempotency, /7 days/);
	assert.match(idempotency, /never expires/);
	assert.doesNotMatch(JSON.stringify([...fieldProperties, ...v2Properties]), /idempotency[^"]*\d+ days|days[^"]*idempotency/i);
});
