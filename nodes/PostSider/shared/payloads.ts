export type PostType = 'draft' | 'schedule';

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
		value: Array<{ content: string; image: PostSiderMedia[] }>;
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
			value: [{ content: channel.content, image: channel.media ?? [] }],
			...(channel.firstComment ? { firstComment: channel.firstComment } : {}),
			settings: channel.settings ?? {},
		})),
	};
}

export function normalizeScheduledDate(value: string): string {
	const hasTimeZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
	const parsed = new Date(hasTimeZone ? value : `${value}Z`);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error('Publish Date must be a valid ISO 8601 date and time');
	}
	return parsed.toISOString();
}

export function parseJsonObject(value: string, fieldName: string): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error(`${fieldName} must contain valid JSON`);
	}
	if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
		throw new Error(`${fieldName} must be a JSON object`);
	}
	return parsed as Record<string, unknown>;
}
