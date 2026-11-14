/* eslint-disable @n8n/community-nodes/no-restricted-imports */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { IExecuteFunctions, IHttpRequestMethods } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { parseIdList, parseMediaJson, parseUrlList } from '../nodes/PostSider/v2/inputs.ts';
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, toMedia, uploadBinaries, uploadFromUrls } from '../nodes/PostSider/v2/media.ts';
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

interface FakeBinary {
	buffer: Buffer;
	mimeType: string;
	fileName?: string;
	/** Filesystem or S3 mode: the property holds an `id` and the size comes from getBinaryMetadata. */
	stored?: boolean;
	/** Size reported by getBinaryMetadata when it differs from the buffer (avoids allocating 500 MB). */
	size?: number;
}

/** Records the order of metadata reads, buffer loads and uploads in `log`. */
function fakeCtx(binaries: Record<string, FakeBinary>, log: string[] = []) {
	return {
		getNode: () => testNode,
		helpers: {
			assertBinaryData: (_i: number, name: string) => {
				const b = binaries[name];
				if (!b) throw new NodeOperationError(testNode, `No binary data property "${name}"`);
				return {
					mimeType: b.mimeType,
					fileName: b.fileName,
					...(b.stored ? { data: 'filesystem-v2', id: `id-${name}` } : { data: b.buffer.toString('base64') }),
				};
			},
			getBinaryMetadata: async (id: string) => {
				const name = id.replace(/^id-/, '');
				log.push(`size:${name}`);
				return { fileSize: binaries[name].size ?? binaries[name].buffer.length };
			},
			getBinaryDataBuffer: async (_i: number, name: string) => {
				log.push(`load:${name}`);
				return binaries[name].buffer;
			},
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
	assert.throws(() => parseIdList(testNode, [], 'Channels'), /'Channels' must list at least one value/);
	assert.throws(() => parseIdList(testNode, ' , ', 'Channels'), /'Channels' must list at least one value/);
});

test('parseUrlList requires public HTTPS URLs without credentials', () => {
	assert.deepEqual(parseUrlList(testNode, 'https://a.example/x.png, https://b.example/y.png'), [
		'https://a.example/x.png',
		'https://b.example/y.png',
	]);
	assert.throws(() => parseUrlList(testNode, 'http://a.example/x.png'), /'Media URLs' must be public HTTPS URLs/);
	assert.throws(() => parseUrlList(testNode, 'https://u:p@h.example/x.png'), /'Media URLs' must be public HTTPS URLs/);
	assert.throws(() => parseUrlList(testNode, 'not a url'), /'Media URLs' must be public HTTPS URLs/);
});

test('parseMediaJson validates id and path', () => {
	assert.deepEqual(parseMediaJson(testNode, ''), []);
	assert.deepEqual(parseMediaJson(testNode, '[{"id":"1","path":"p"}]'), [{ id: '1', path: 'p' }]);
	assert.throws(() => parseMediaJson(testNode, '[{"id":"1"}]'), /must include non-empty id and path/);
	assert.throws(() => parseMediaJson(testNode, '{}'), /must be a JSON array/);
	assert.throws(() => parseMediaJson(testNode, '{bad'), /valid JSON/);
});

test('toMedia keeps known fields and rejects incomplete responses', () => {
	assert.deepEqual(toMedia(testNode, { id: '1', path: 'p', name: 'n', thumbnail: 't', alt: 'a', extra: 1 }), {
		id: '1',
		path: 'p',
		name: 'n',
		thumbnail: 't',
		alt: 'a',
	});
	assert.deepEqual(toMedia(testNode, { id: '1', path: 'p' }), { id: '1', path: 'p' });
	assert.throws(() => toMedia(testNode, { id: '1' }), NodeOperationError);
	assert.throws(() => toMedia(testNode, null), NodeOperationError);
});

test('uploadFromUrls posts each URL sequentially', async () => {
	const calls: Call[] = [];
	const media = await uploadFromUrls(testNode, recorder(calls), ['https://a.example/1.png', 'https://a.example/2.png']);
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

// ---- upload size limits: images 10 MB, videos 500 MB ----

const MB = 1024 * 1024;

test('uploadBinaries accepts an image of exactly 10 MB and a video above 20 MB', async () => {
	assert.equal(MAX_IMAGE_BYTES, 10 * MB);
	assert.equal(MAX_VIDEO_BYTES, 500 * MB);
	const calls: Call[] = [];
	const ctx = fakeCtx({ data: { buffer: Buffer.alloc(10 * MB, 1), mimeType: 'image/png', fileName: 'edge.png' } });
	await uploadBinaries(ctx, recorder(calls), 0, ['data']);
	assert.equal(calls.length, 1);
});

test('uploadBinaries refuses an image over 10 MB and names the file and the limit', async () => {
	const calls: Call[] = [];
	const ctx = fakeCtx({ data: { buffer: Buffer.alloc(10 * MB + 1, 1), mimeType: 'image/jpeg', fileName: 'big photo.jpg' } });
	await assert.rejects(
		uploadBinaries(ctx, recorder(calls), 0, ['data']),
		(error: Error) => {
			assert.ok(error instanceof NodeOperationError);
			assert.match(error.message, /'big photo\.jpg'/);
			assert.match(error.message, /Images can be up to 10 MB/);
			return true;
		},
	);
	assert.equal(calls.length, 0);
});

test('uploadBinaries refuses a video over 500 MB and uses the property name when the file has no name', async () => {
	const calls: Call[] = [];
	// stored files are sized from the metadata, so nothing is loaded and no 500 MB buffer is needed
	const log: string[] = [];
	const ctx = fakeCtx({ clip: { buffer: Buffer.alloc(0), size: 500 * MB + 1, stored: true, mimeType: 'video/mp4' } }, log);
	await assert.rejects(
		uploadBinaries(ctx, recorder(calls), 0, ['clip']),
		(error: Error) => {
			assert.match(error.message, /'clip'/);
			assert.match(error.message, /Videos can be up to 500 MB/);
			return true;
		},
	);
	assert.equal(calls.length, 0);
	assert.deepEqual(log, ['size:clip'], 'the file was never loaded');
});

test('uploadBinaries checks every file before it uploads the first one', async () => {
	const calls: Call[] = [];
	const ctx = fakeCtx({
		small: { buffer: Buffer.from('x'), mimeType: 'image/png', fileName: 'small.png' },
		big: { buffer: Buffer.alloc(11 * MB), mimeType: 'image/png', fileName: 'big.png' },
	});
	await assert.rejects(uploadBinaries(ctx, recorder(calls), 0, ['small', 'big']), /'big\.png'/);
	assert.equal(calls.length, 0, 'the small file was not uploaded either');
});

test('uploadBinaries checks all sizes from the metadata first, then loads each file right before its upload', async () => {
	const log: string[] = [];
	const upload = (async (_m: string, endpoint: string) => {
		log.push(`upload:${endpoint}`);
		return { id: `m${log.length}`, path: 'https://cdn.example/x.png' };
	}) as never;
	const ctx = fakeCtx(
		{
			a: { buffer: Buffer.from('aa'), mimeType: 'image/png', fileName: 'a.png', stored: true },
			b: { buffer: Buffer.from('bbb'), mimeType: 'image/png', fileName: 'b.png' },
		},
		log,
	);
	await uploadBinaries(ctx, upload, 0, ['a', 'b']);
	assert.deepEqual(log, ['size:a', 'load:a', 'upload:/upload-base64', 'load:b', 'upload:/upload-base64']);
});

test('in-memory binaries are sized from their base64 text, padding included', async () => {
	// 10 MB + 1 byte as base64 has one '=' of padding; just under 10 MB also has padding and is accepted
	const over = Buffer.alloc(10 * MB + 1, 1);
	assert.ok(over.toString('base64').endsWith('='));
	await assert.rejects(
		uploadBinaries(fakeCtx({ x: { buffer: over, mimeType: 'image/png', fileName: 'x.png' } }), recorder([]), 0, ['x']),
		/Images can be up to 10 MB/,
	);
	const exact = Buffer.alloc(10 * MB - 2, 1);
	assert.ok(exact.toString('base64').endsWith('='));
	const calls: Call[] = [];
	await uploadBinaries(fakeCtx({ x: { buffer: exact, mimeType: 'image/png', fileName: 'x.png' } }), recorder(calls), 0, ['x']);
	assert.equal(calls.length, 1);
});

test('the URL list is not split inside a URL that holds a comma', () => {
	const cloudinary = 'https://res.cloudinary.com/x/image/upload/w_800,h_600/a.jpg';
	assert.deepEqual(parseUrlList(testNode, cloudinary), [cloudinary]);
	assert.deepEqual(parseUrlList(testNode, `${cloudinary}\nhttps://b.example/y.png`), [cloudinary, 'https://b.example/y.png']);
	assert.deepEqual(parseUrlList(testNode, `${cloudinary}, https://b.example/y.png`), [cloudinary, 'https://b.example/y.png']);
	assert.deepEqual(parseUrlList(testNode, `["${cloudinary}"]`), [cloudinary]);
});

test('an invalid media URL is named in the error, without its credentials', () => {
	assert.throws(() => parseUrlList(testNode, 'https://a.example/x.png\nhttp://b.example/y.png'), /This one is not: http:\/\/b\.example\/y\.png/);
	assert.throws(
		() => parseUrlList(testNode, 'https://user:secret@h.example/x.png'),
		(error: Error) => /This one is not: https:\/\/h\.example\/x\.png/.test(error.message) && !error.message.includes('secret'),
	);
});

test('uploadBinaries leaves other file types to the server', async () => {
	const calls: Call[] = [];
	const ctx = fakeCtx({ data: { buffer: Buffer.alloc(11 * MB), mimeType: 'application/octet-stream', fileName: 'file.bin' } });
	await uploadBinaries(ctx, recorder(calls), 0, ['data']);
	assert.equal(calls.length, 1);
});
