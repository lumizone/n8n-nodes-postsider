import type { IDataObject, IExecuteFunctions, IHttpRequestMethods, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { assertMediaUrl } from '../shared/mediaUrl';
import type { PostSiderMedia } from '../shared/payloads';
import { SLOW_REQUEST_TIMEOUT_MS, type RequestInput } from '../shared/transport';

export type ApiCall = <T>(
	method: IHttpRequestMethods,
	endpoint: string,
	input?: RequestInput,
) => Promise<T>;

export const BASE64_MAX_BYTES = 20 * 1024 * 1024;
/** Upload limits of PostSider on every upload route. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 120000;

export function toMedia(node: INode, response: unknown): PostSiderMedia {
	const raw = (response ?? {}) as Record<string, unknown>;
	const id = String(raw.id ?? '');
	const path = String(raw.path ?? '');
	if (!id || !path) {
		throw new NodeOperationError(node, 'The upload response did not include a media ID and path');
	}
	const media: PostSiderMedia = { id, path };
	for (const key of ['name', 'thumbnail', 'alt']) {
		if (raw[key] !== undefined && raw[key] !== null) media[key] = raw[key];
	}
	return media;
}

function megabytes(bytes: number): string {
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Refuses an image over 10 MB or a video over 500 MB before it is sent; other types are left to the server. */
export function assertUploadSize(
	node: INode,
	filename: string,
	mimeType: string | undefined,
	bytes: number,
	itemIndex?: number,
): void {
	const type = String(mimeType ?? '').toLowerCase();
	const limit = type.startsWith('image/') ? MAX_IMAGE_BYTES : type.startsWith('video/') ? MAX_VIDEO_BYTES : undefined;
	if (limit === undefined || bytes <= limit) return;
	const kind = limit === MAX_IMAGE_BYTES ? 'Images' : 'Videos';
	throw new NodeOperationError(
		node,
		`The file '${filename}' is ${megabytes(bytes)}. ${kind} can be up to ${limit / (1024 * 1024)} MB.`,
		itemIndex === undefined ? {} : { itemIndex },
	);
}

export async function uploadFromUrls(
	node: INode,
	api: ApiCall,
	urls: string[],
): Promise<PostSiderMedia[]> {
	const media: PostSiderMedia[] = [];
	for (const url of urls) assertMediaUrl(node, url, 'Media URLs');
	for (const url of urls) {
		const response = await api<unknown>('POST', '/upload-from-url', {
			body: { url } as IDataObject,
			timeout: SLOW_REQUEST_TIMEOUT_MS,
		});
		media.push(toMedia(node, response));
	}
	return media;
}

/** Bytes of an in-memory base64 string, without reading it into a Buffer. */
function base64Bytes(data: string): number {
	const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
	return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

/**
 * Size of a binary property without loading it: the stored size when n8n keeps the file on disk or in
 * S3 (the property has an `id`), otherwise the size of the base64 text held in memory.
 */
async function binarySize(
	ctx: IExecuteFunctions,
	meta: { id?: string; data: string },
): Promise<number> {
	if (meta.id) return (await ctx.helpers.getBinaryMetadata(meta.id)).fileSize;
	return base64Bytes(meta.data);
}

export async function uploadBinaries(
	ctx: IExecuteFunctions,
	api: ApiCall,
	itemIndex: number,
	propertyNames: string[],
	/** Display name of the field the names came from, for the error text. */
	fieldName = 'Input Binary Field',
): Promise<PostSiderMedia[]> {
	if (propertyNames.length === 0) {
		throw new NodeOperationError(ctx.getNode(), `'${fieldName}' must list at least one value`, {
			itemIndex,
		});
	}
	// Fail on every missing property before the first upload happens.
	const metas = propertyNames.map((name) => ({
		name,
		meta: ctx.helpers.assertBinaryData(itemIndex, name),
	}));
	// Check every size from the metadata first, so an oversized file sends nothing and no file is read yet.
	for (const { name, meta } of metas) {
		const filename = meta.fileName || `${name}`;
		assertUploadSize(ctx.getNode(), filename, meta.mimeType, await binarySize(ctx, meta), itemIndex);
	}
	// Read each file right before its upload, so only one file is in memory at a time.
	const media: PostSiderMedia[] = [];
	for (const { name, meta } of metas) {
		const filename = meta.fileName || `${name}`;
		const buffer = await ctx.helpers.getBinaryDataBuffer(itemIndex, name);
		let response: unknown;
		if (buffer.length <= BASE64_MAX_BYTES) {
			response = await api<unknown>('POST', '/upload-base64', {
				body: { data: buffer.toString('base64'), filename } as IDataObject,
			});
		} else {
			const formData = new FormData();
			formData.append('file', new Blob([buffer], { type: meta.mimeType }), filename);
			response = await api<unknown>('POST', '/upload', { formData, timeout: UPLOAD_TIMEOUT_MS });
		}
		media.push(toMedia(ctx.getNode(), response));
	}
	return media;
}
