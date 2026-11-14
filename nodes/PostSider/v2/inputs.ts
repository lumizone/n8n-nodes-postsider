import type { INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { assertMediaUrl } from '../shared/mediaUrl';
import type { PostSiderMedia } from '../shared/payloads';

/** URLs are separated by new lines, or by a comma that is followed by the next `http(s)://` URL. */
const URL_SEPARATOR = /\n|,(?=\s*https?:)/i;

function splitList(value: unknown, separator: RegExp = /[\n,]/): string[] {
	let items: unknown[];
	if (Array.isArray(value)) {
		items = value;
	} else if (typeof value === 'string') {
		const text = value.trim();
		if (text.startsWith('[')) {
			try {
				const parsed: unknown = JSON.parse(text);
				items = Array.isArray(parsed) ? parsed : [text];
			} catch {
				items = text.split(separator);
			}
		} else {
			items = text.split(separator);
		}
	} else {
		items = [];
	}
	const seen = new Set<string>();
	for (const item of items) {
		const trimmed = String(item ?? '').trim();
		if (trimmed) seen.add(trimmed);
	}
	return [...seen];
}

export function parseIdList(node: INode, value: unknown, displayName: string): string[] {
	const list = splitList(value);
	if (list.length === 0) {
		throw new NodeOperationError(node, `'${displayName}' must list at least one value`);
	}
	return list;
}

export function parseUrlList(node: INode, value: unknown): string[] {
	const list = splitList(value, URL_SEPARATOR);
	for (const url of list) assertMediaUrl(node, url, 'Media URLs');
	return list;
}

export function parseMediaJson(node: INode, value: unknown): PostSiderMedia[] {
	if (value === undefined || value === null || value === '') return [];
	let parsed: unknown;
	try {
		parsed = typeof value === 'string' ? JSON.parse(value) : value;
	} catch {
		throw new NodeOperationError(node, "'Media JSON' must contain valid JSON");
	}
	if (!Array.isArray(parsed)) {
		throw new NodeOperationError(node, "'Media JSON' must be a JSON array");
	}
	for (const item of parsed as PostSiderMedia[]) {
		if (!item || typeof item !== 'object' || !String(item.id ?? '') || !String(item.path ?? '')) {
			throw new NodeOperationError(node, "'Media JSON' entries must include non-empty id and path fields");
		}
	}
	return parsed as PostSiderMedia[];
}
