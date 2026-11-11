import { normalizePostResponse, simplifyPostResponse } from '../PostSider/shared/operations';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SEEN_LIMIT = 2000;

const EVENT_STATES: Record<string, string> = {
	published: 'PUBLISHED',
	failed: 'ERROR',
	scheduled: 'QUEUE',
};

export function pollWindow(now: Date, lastPoll?: string): { startDate: string; endDate: string } {
	const parsed = lastPoll ? new Date(lastPoll).getTime() : Number.NaN;
	const base = Number.isNaN(parsed) ? now.getTime() : parsed;
	const start = Math.max(base - HOUR, now.getTime() - 7 * DAY);
	return {
		startDate: new Date(start).toISOString(),
		endDate: new Date(now.getTime() + 30 * DAY).toISOString(),
	};
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function keyOf(post: Record<string, unknown>): string {
	return `${String(post.id)}:${String(post.state)}`;
}

function channelOf(post: Record<string, unknown>): string {
	return String(asRecord(post.integration)?.id ?? '');
}

export function extractPosts(response: unknown): unknown[] {
	const normalized = normalizePostResponse(response);
	if (Array.isArray(normalized)) return normalized;
	const posts = asRecord(normalized)?.posts;
	return Array.isArray(posts) ? posts : [];
}

function matches(post: Record<string, unknown>, events: string[], channels: string[]): string | undefined {
	const event = events.find((name) => EVENT_STATES[name] === post.state);
	if (!event) return undefined;
	if (channels.length > 0 && !channels.includes(channelOf(post))) return undefined;
	return event;
}

function toItem(post: Record<string, unknown>, event: string): Record<string, unknown> {
	return { ...simplifyPostResponse(post), event };
}

/** `seen` undefined means first run: seed every key and emit nothing. */
export function selectNewPosts(
	posts: unknown[],
	events: string[],
	channels: string[],
	seen: string[] | undefined,
): { emit: Record<string, unknown>[]; seen: string[] } {
	const rows = posts.map(asRecord).filter((row): row is Record<string, unknown> => !!row && row.id !== undefined);
	const known = new Set(seen ?? []);
	const order = [...(seen ?? [])];
	const emit: Record<string, unknown>[] = [];
	for (const row of rows) {
		const key = keyOf(row);
		if (known.has(key)) continue;
		known.add(key);
		order.push(key);
		if (seen === undefined) continue;
		const event = matches(row, events, channels);
		if (event) emit.push(toItem(row, event));
	}
	return { emit, seen: order.slice(-SEEN_LIMIT) };
}

/** Manual mode: the newest matching post by publishDate, nothing stored. */
export function newestMatching(
	posts: unknown[],
	events: string[],
	channels: string[],
): Record<string, unknown>[] {
	let best: { row: Record<string, unknown>; event: string; time: number } | undefined;
	for (const raw of posts) {
		const row = asRecord(raw);
		if (!row) continue;
		const event = matches(row, events, channels);
		if (!event) continue;
		const time = new Date(String(row.publishDate)).getTime() || 0;
		if (!best || time > best.time) best = { row, event, time };
	}
	return best ? [toItem(best.row, best.event)] : [];
}
