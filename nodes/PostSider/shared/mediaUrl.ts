import type { INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

export function isPublicHttpsUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && !url.username && !url.password;
	} catch {
		return false;
	}
}

/**
 * Checks a public media URL before it is sent: HTTPS without credentials. PostSider detects the file type
 * from the file itself, so the URL does not need a file extension.
 */
export function assertMediaUrl(node: INode, value: string, fieldName: string): void {
	if (!isPublicHttpsUrl(value)) {
		throw new NodeOperationError(node, `'${fieldName}' must be public HTTPS URLs`);
	}
}
