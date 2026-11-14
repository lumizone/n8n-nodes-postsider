import type { INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

export type PostType = 'draft' | 'schedule' | 'now';

export interface PostSiderMedia {
	id: string;
	path: string;
	[key: string]: unknown;
}

export interface PostSiderTag {
	value: string;
	label: string;
}

export interface ChannelPostInput {
	channelId: string;
	content: string;
	firstComment?: string;
	media?: PostSiderMedia[];
	/** Thread parts posted after the main text, in order. `delay` is minutes to wait before the part. */
	thread?: Array<{ content: string; delay?: number }>;
	settings?: Record<string, unknown>;
}

export interface CreatePostInput {
	type: PostType;
	date: string;
	shortLink: boolean;
	tags?: PostSiderTag[];
	channels: ChannelPostInput[];
}

export interface CreatePostBody {
	type: PostType;
	date: string;
	shortLink: boolean;
	tags: PostSiderTag[];
	creationMethod: 'API';
	posts: Array<{
		integration: { id: string };
		value: Array<{ content: string; image: PostSiderMedia[]; delay?: number }>;
		firstComment?: string;
		settings: Record<string, unknown>;
	}>;
}

export function buildCreatePostBody(input: CreatePostInput): CreatePostBody {
	return {
		type: input.type,
		date: input.date,
		shortLink: input.shortLink,
		tags: input.tags ?? [],
		creationMethod: 'API',
		posts: input.channels.map((channel) => ({
			integration: { id: channel.channelId },
			value: [
				{ content: channel.content, image: channel.media ?? [] },
				...(channel.thread ?? []).map((part) => ({
					content: part.content,
					image: [] as PostSiderMedia[],
					...(part.delay ? { delay: part.delay } : {}),
				})),
			],
			...(channel.firstComment ? { firstComment: channel.firstComment } : {}),
			settings: channel.settings ?? {},
		})),
	};
}

// A time zone only counts after a time of day, so the "-10" of a plain date is never read as an offset.
const DATE_WITH_ZONE =
	/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}(?::?\d{2})?)$/i;

/**
 * Turns an ISO 8601 date and time into a UTC ISO string. Time zones `Z`, `+HH:MM`, `+HHMM` and `+HH` are
 * understood; a value without a time zone is read as UTC. `fieldName` is the display name of the field
 * the value came from and is used in the error message.
 */
export function normalizeScheduledDate(
	node: INode,
	value: string,
	fieldName = 'Publish Date',
): string {
	const text = value.trim();
	const match = DATE_WITH_ZONE.exec(text);
	let candidate = `${text}Z`;
	if (match) {
		const base = match[1].replace(' ', 'T');
		const zone = match[2];
		if (zone.toUpperCase() === 'Z') {
			candidate = `${base}Z`;
		} else {
			const digits = zone.slice(1).replace(':', '');
			candidate = `${base}${zone[0]}${digits.slice(0, 2)}:${digits.slice(2) || '00'}`;
		}
	} else if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) candidate = text;
	const parsed = new Date(candidate);
	if (Number.isNaN(parsed.getTime())) {
		throw new NodeOperationError(node, `'${fieldName}' must be a valid ISO 8601 date and time`);
	}
	return parsed.toISOString();
}

export function parseJsonObject(
	node: INode,
	value: string,
	fieldName: string,
): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new NodeOperationError(node, `${fieldName} must contain valid JSON`);
	}
	if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
		throw new NodeOperationError(node, `${fieldName} must be a JSON object`);
	}
	return parsed as Record<string, unknown>;
}
