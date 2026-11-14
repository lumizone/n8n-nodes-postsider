import type { INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/** Extensions the backend accepts for a public media URL. Matching is case-sensitive, like the backend. */
export const MEDIA_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.webm', '.mov'];

/**
 * Same rule as the backend (`ValidUrlExtension`): the part before the first `?` must end with one of the
 * extensions. A query string is allowed, a fragment is not, and `.JPG` is rejected.
 */
export function hasMediaExtension(url: string): boolean {
	const path = url.split('?')[0];
	return MEDIA_EXTENSIONS.some((extension) => path.endsWith(extension));
}

export function isPublicHttpsUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && !url.username && !url.password;
	} catch {
		return false;
	}
}

/**
 * Checks a public media URL before it is sent: HTTPS without credentials, and a path that ends in a
 * supported extension. Both would otherwise come back from PostSider as a plain 400.
 */
export function assertMediaUrl(node: INode, value: string, fieldName: string): void {
	if (!isPublicHttpsUrl(value)) {
		throw new NodeOperationError(node, `'${fieldName}' must be public HTTPS URLs`);
	}
	if (!hasMediaExtension(value)) {
		throw new NodeOperationError(
			node,
			`'${fieldName}' must end in a supported file extension: ${MEDIA_EXTENSIONS.join(', ')} (lowercase). Not supported: ${value}`,
		);
	}
}
