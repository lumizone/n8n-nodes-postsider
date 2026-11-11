import type { IDataObject, IExecuteFunctions, IHttpRequestMethods } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { PostSiderMedia } from '../shared/payloads';
import type { RequestInput } from '../shared/transport';

export type ApiCall = <T>(
	method: IHttpRequestMethods,
	endpoint: string,
	input?: RequestInput,
) => Promise<T>;

export const BASE64_MAX_BYTES = 20 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 120000;

export function toMedia(response: unknown): PostSiderMedia {
	const raw = (response ?? {}) as Record<string, unknown>;
	const id = String(raw.id ?? '');
	const path = String(raw.path ?? '');
	if (!id || !path) {
		throw new Error('Upload response did not include a media id and path');
	}
	const media: PostSiderMedia = { id, path };
	for (const key of ['name', 'thumbnail', 'alt']) {
		if (raw[key] !== undefined && raw[key] !== null) media[key] = raw[key];
	}
	return media;
}

export async function uploadFromUrls(api: ApiCall, urls: string[]): Promise<PostSiderMedia[]> {
	const media: PostSiderMedia[] = [];
	for (const url of urls) {
		const response = await api<unknown>('POST', '/upload-from-url', {
			body: { url } as IDataObject,
		});
		media.push(toMedia(response));
	}
	return media;
}

export async function uploadBinaries(
	ctx: IExecuteFunctions,
	api: ApiCall,
	itemIndex: number,
	propertyNames: string[],
): Promise<PostSiderMedia[]> {
	if (propertyNames.length === 0) {
		throw new NodeOperationError(ctx.getNode(), 'Binary property names must list at least one value', {
			itemIndex,
		});
	}
	// Fail on every missing property before the first upload happens.
	const metas = propertyNames.map((name) => ({
		name,
		meta: ctx.helpers.assertBinaryData(itemIndex, name),
	}));
	const media: PostSiderMedia[] = [];
	for (const { name, meta } of metas) {
		const buffer = await ctx.helpers.getBinaryDataBuffer(itemIndex, name);
		const filename = meta.fileName || `${name}`;
		let response: unknown;
		if (buffer.length <= BASE64_MAX_BYTES) {
			response = await api<unknown>('POST', '/upload-base64', {
				body: { data: buffer.toString('base64'), filename } as IDataObject,
			});
		} else {
			const formData = new FormData();
			formData.append(
				'file',
				new Blob([buffer], { type: meta.mimeType }),
				filename,
			);
			response = await api<unknown>('POST', '/upload', { formData, timeout: UPLOAD_TIMEOUT_MS });
		}
		media.push(toMedia(response));
	}
	return media;
}
