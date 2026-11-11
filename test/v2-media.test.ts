/* eslint-disable @n8n/community-nodes/no-restricted-imports */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { IExecuteFunctions, IHttpRequestMethods } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { parseIdList, parseMediaJson, parseUrlList } from '../nodes/PostSider/v2/inputs.ts';
import { toMedia, uploadBinaries, uploadFromUrls } from '../nodes/PostSider/v2/media.ts';
import { testNode } from './helpers.ts';

interface Call {
	method: IHttpRequestMethods;
	endpoint: string;
	input?: { body?: unknown; formData?: FormData; timeout?: number };
}

function recorder(calls: Call[]) {
	return (async (method: IHttpRequestMethods, endpoint: string, input?: Call['input']) => {
		calls.push({ method, endpoint, input });
		return { id: `m${calls.length}`, path: `https://cdn.example/${calls.length}.png`, name: 'n', extra: 'x' };
	}) as never;
}

function fakeCtx(binaries: Record<string, { buffer: Buffer; mimeType: string; fileName?: string }>) {
	return {
		helpers: {
			assertBinaryData: (_i: number, name: string) => {
				const b = binaries[name];
				if (!b) throw new NodeOperationError(testNode, `No binary data property "${name}"`);
				return { mimeType: b.mimeType, fileName: b.fileName, data: '' };
			},
			getBinaryDataBuffer: async (_i: number, name: string) => binaries[name].buffer,
		},
	} as unknown as IExecuteFunctions;
}

test('parseIdList splits, trims, dedupes and drops empties', () => {
	assert.deepEqual(parseIdList(testNode, 'a, b,,a', 'Channels'), ['a', 'b']);
	assert.deepEqual(parseIdList(testNode, 'a\nb', 'Channels'), ['a', 'b']);
	assert.deepEqual(parseIdList(testNode, '["x","y"]', 'Channels'), ['x', 'y']);
	assert.deepEqual(parseIdList(testNode, [' p ', 'q', 'p'], 'Channels'), ['p', 'q']);
});

test('parseIdList throws on empty input', () => {
	assert.throws(() => parseIdList(testNode, [], 'Channels'), /Channels must list at least one value/);
	assert.throws(() => parseIdList(testNode, ' , ', 'Channels'), /Channels must list at least one value/);
});

test('parseUrlList requires public HTTPS URLs without credentials', () => {
	assert.deepEqual(parseUrlList(testNode, 'https://a.example/x.png, https://b.example/y.png'), [
		'https://a.example/x.png',
		'https://b.example/y.png',
	]);
	assert.throws(() => parseUrlList(testNode, 'http://a.example/x.png'), /Media URLs must be public HTTPS URLs/);
	assert.throws(() => parseUrlList(testNode, 'https://u:p@h.example/x.png'), /Media URLs must be public HTTPS URLs/);
	assert.throws(() => parseUrlList(testNode, 'not a url'), /Media URLs must be public HTTPS URLs/);
});

test('parseMediaJson validates id and path', () => {
	assert.deepEqual(parseMediaJson(testNode, ''), []);
	assert.deepEqual(parseMediaJson(testNode, '[{"id":"1","path":"p"}]'), [{ id: '1', path: 'p' }]);
	assert.throws(() => parseMediaJson(testNode, '[{"id":"1"}]'), /must include non-empty id and path/);
	assert.throws(() => parseMediaJson(testNode, '{}'), /must be a JSON array/);
	assert.throws(() => parseMediaJson(testNode, '{bad'), /valid JSON/);
});

test('toMedia keeps known fields and rejects incomplete responses', () => {
	assert.deepEqual(toMedia({ id: '1', path: 'p', name: 'n', thumbnail: 't', alt: 'a', extra: 1 }), {
		id: '1',
		path: 'p',
		name: 'n',
		thumbnail: 't',
		alt: 'a',
	});
	assert.deepEqual(toMedia({ id: '1', path: 'p' }), { id: '1', path: 'p' });
	assert.throws(() => toMedia({ id: '1' }));
	assert.throws(() => toMedia(null));
});

test('uploadFromUrls posts each URL sequentially', async () => {
	const calls: Call[] = [];
	const media = await uploadFromUrls(recorder(calls), ['https://a.example/1.png', 'https://a.example/2.png']);
	assert.equal(media.length, 2);
	assert.deepEqual(
		calls.map((c) => [c.method, c.endpoint, c.input?.body]),
		[
			['POST', '/upload-from-url', { url: 'https://a.example/1.png' }],
			['POST', '/upload-from-url', { url: 'https://a.example/2.png' }],
		],
	);
});

test('uploadBinaries fails before any upload when a later property is missing', async () => {
	const calls: Call[] = [];
	const ctx = fakeCtx({ data: { buffer: Buffer.from('x'), mimeType: 'image/png' } });
	await assert.rejects(uploadBinaries(ctx, recorder(calls), 0, ['data', 'missing']), NodeOperationError);
	assert.equal(calls.length, 0);
});

test('uploadBinaries sends small buffers as base64 with the filename', async () => {
	const calls: Call[] = [];
	const buffer = Buffer.alloc(1024, 7);
	const ctx = fakeCtx({ data: { buffer, mimeType: 'image/png', fileName: 'pic.png' } });
	const media = await uploadBinaries(ctx, recorder(calls), 0, ['data']);
	assert.equal(media.length, 1);
	assert.equal(calls[0].endpoint, '/upload-base64');
	assert.deepEqual(calls[0].input?.body, { data: buffer.toString('base64'), filename: 'pic.png' });
});

test('uploadBinaries sends large buffers as multipart file with a long timeout', async () => {
	const calls: Call[] = [];
	const buffer = Buffer.alloc(21 * 1024 * 1024, 1);
	const ctx = fakeCtx({ data: { buffer, mimeType: 'video/mp4', fileName: 'clip.mp4' } });
	await uploadBinaries(ctx, recorder(calls), 0, ['data']);
	assert.equal(calls[0].endpoint, '/upload');
	const form = calls[0].input?.formData;
	assert.ok(form instanceof FormData);
	const file = form.get('file') as File;
	assert.equal(file.name, 'clip.mp4');
	assert.equal(file.type, 'video/mp4');
	assert.equal(file.size, buffer.length);
	assert.equal(calls[0].input?.body, undefined);
	assert.equal(calls[0].input?.timeout, 120000);
});
