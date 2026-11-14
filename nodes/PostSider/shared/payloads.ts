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

// ISO 8601: a date, or a date and a time (T or a space between them, optional seconds and fraction),
// optionally followed by Z or an offset (+HH, +HHMM, +HH:MM). An offset only counts after a time of day.
const ISO_DATE =
	/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i;

/** Milliseconds from UTC to the wall clock of `zone` at the instant `ms`. */
function zoneOffsetMs(ms: number, zone: string): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: zone,
		hourCycle: 'h23',
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: 'numeric',
		second: 'numeric',
	}).formatToParts(new Date(ms));
	const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
	const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
	return wall - Math.floor(ms / 1000) * 1000;
}

/** The instant at which the wall clock of `zone` shows `wallMs` (read as if it were UTC). */
function wallClockToUtc(wallMs: number, zone: string): number {
	try {
		let utc = wallMs - zoneOffsetMs(wallMs, zone);
		utc = wallMs - zoneOffsetMs(utc, zone);
		return utc;
	} catch {
		return wallMs; // unknown time zone name: read as UTC
	}
}

/**
 * Turns an ISO 8601 date or date and time into a UTC ISO string. Time zones `Z`, `+HH:MM`, `+HHMM` and `+HH`
 * are understood. A value without a time zone is read as UTC, or in `zone` (an IANA name such as the
 * workflow time zone) when one is given. Anything else, and dates that do not exist (2026-02-30, hour 24,
 * month 13), is refused. `fieldName` is the display name of the field the value came from and is used in
 * the error message.
 */
export function normalizeScheduledDate(
	node: INode,
	value: string,
	fieldName = 'Publish Date',
	zone?: string,
): string {
	const fail = () =>
		new NodeOperationError(node, `'${fieldName}' must be a valid ISO 8601 date and time`);
	const match = ISO_DATE.exec(String(value).trim());
	if (!match) throw fail();
	const [, year, month, day, hour = '0', minute = '0', second = '0', fraction = '', zoneText] = match;
	const [y, mo, d, h, mi, sec] = [year, month, day, hour, minute, second].map(Number);
	const ms = Number(`${fraction}000`.slice(0, 3));
	const date = new Date(0);
	date.setUTCFullYear(y, mo - 1, d);
	date.setUTCHours(h, mi, sec, ms);
	if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) throw fail();
	if (h > 23 || mi > 59 || sec > 59) throw fail();
	let instant = date.getTime();
	if (zoneText === undefined) {
		if (zone) instant = wallClockToUtc(instant, zone);
	} else if (zoneText.toUpperCase() !== 'Z') {
		const digits = zoneText.slice(1).replace(':', '');
		const offsetHours = Number(digits.slice(0, 2));
		const offsetMinutes = Number(digits.slice(2) || '0');
		if (offsetHours > 23 || offsetMinutes > 59) throw fail();
		const offset = (offsetHours * 60 + offsetMinutes) * 60000;
		instant -= zoneText[0] === '-' ? -offset : offset;
	}
	const result = new Date(instant);
	if (Number.isNaN(result.getTime())) throw fail();
	return result.toISOString();
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
		throw new NodeOperationError(node, `'${fieldName}' must contain valid JSON`);
	}
	if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
		throw new NodeOperationError(node, `'${fieldName}' must be a JSON object`);
	}
	return parsed as Record<string, unknown>;
}
