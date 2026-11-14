import { normalizePostResponse, simplifyPostFlat, simplifyPostResponse } from '../PostSider/shared/operations';

const DAY = 24 * 3_600_000;
const SEEN_LIMIT = 10000;

const EVENT_STATES: Record<string, string> = {
	published: 'PUBLISHED',
	failed: 'ERROR',
	scheduled: 'QUEUE',
};

export function pollWindow(now: Date): { startDate: string; endDate: string } {
	return {
		startDate: new Date(now.getTime() - 7 * DAY).toISOString(),
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

/** Version 1.1 emits the flat post of node version 2.1 plus `event`; version 1 keeps the longer shape. */
function toItem(post: Record<string, unknown>, event: string, flat: boolean): Record<string, unknown> {
	const item: Record<string, unknown> = {
		...(flat ? simplifyPostFlat(post) : simplifyPostResponse(post)),
		event,
	};
	for (const key of ['error', 'errorCode', 'errorCategory', 'errorRetryable']) {
		if (Object.prototype.hasOwnProperty.call(post, key)) item[key] = post[key];
	}
	return item;
}

/**
 * `seen` undefined means first run: seed and emit nothing. Afterwards `seen`
 * becomes exactly the keys present in this response (capped), so a key leaves
 * only when its post leaves the window or changes state.
 */
export function selectNewPosts(
	posts: unknown[],
	events: string[],
	channels: string[],
	seen: string[] | undefined,
	flat = true,
): { emit: Record<string, unknown>[]; seen: string[] } {
	const rows = posts.map(asRecord).filter((row): row is Record<string, unknown> => !!row && row.id !== undefined);
	const previous = new Set(seen ?? []);
	const current = new Set<string>();
	const emit: Record<string, unknown>[] = [];
	for (const row of rows) {
		const key = keyOf(row);
		if (current.has(key)) continue;
		current.add(key);
		if (seen === undefined || previous.has(key)) continue;
		const event = matches(row, events, channels);
		if (event) emit.push(toItem(row, event, flat));
	}
	return { emit, seen: [...current].slice(-SEEN_LIMIT) };
}

/** Manual mode: the newest matching post by publishDate, nothing stored. */
export function newestMatching(
	posts: unknown[],
	events: string[],
	channels: string[],
	flat = true,
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
	return best ? [toItem(best.row, best.event, flat)] : [];
}
