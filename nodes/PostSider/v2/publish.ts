import type { IDataObject, IExecuteFunctions, INode, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

import {
	buildCreatePostBody,
	normalizeScheduledDate,
	parseJsonObject,
	type ChannelPostInput,
	type PostSiderMedia,
	type PostSiderTag,
} from '../shared/payloads';
import { httpStatusOf, retryAfterMsOf } from '../shared/errors';
import { executionScope, runIndexOf } from '../shared/idempotency';
import { binaryFieldLabel, dateZone, isCurrent } from '../shared/versions';
import { nodeToken, validateIdempotencyKey, type OperationRequest } from '../shared/operations';
import { postSiderApiRequest } from '../shared/transport';
import { parseIdList, parseMediaJson, parseUrlList } from './inputs';
import { uploadBinaries, uploadFromUrls, type ApiCall } from './media';
import { buildChannelSettings, type PlatformSettingsInput } from './platformSettings';

export type PublishWhen = 'now' | 'schedule' | 'nextSlot' | 'draft';

export interface ThreadPartInput {
	text: string;
	delayMinutes: number;
}

export interface PublishInput {
	channels: string[];
	text: string;
	when: PublishWhen;
	date?: string;
	media: PostSiderMedia[];
	firstComment?: string;
	perChannelText: Record<string, string>;
	platform: PlatformSettingsInput;
	settingsJson: Record<string, unknown>;
	tags: PostSiderTag[];
	shortLink: boolean;
	idempotencyKey: string;
	threadParts?: ThreadPartInput[];
}

const YOUTUBE_TITLE_MIN = 2;
const YOUTUBE_TITLE_MAX = 100;
const WAIT_MIN_SECONDS = 1;
const WAIT_MAX_SECONDS = 300;
const DEFAULT_WAIT_INTERVAL_MS = 5000;

const THREAD_DELAY_MAX_MINUTES = 1440;
const CACHE_MAX_ENTRIES = 500;
const CONFLICT_TEXT = 'already used with a different request';
const PROCESSING_TEXT = 'is already processing';
const PROCESSING_RETRIES = 3;
const PROCESSING_WAIT_MS = 5000;
const KEY_REUSED_MESSAGE = 'The Idempotency Key was already used for a different post';
const KEY_REUSED_DESCRIPTION =
	"PostSider remembers every Idempotency Key permanently and answers a reused key with the first request. Set a unique 'Idempotency Key' in Options for this post.";
const ALREADY_SUBMITTED_MESSAGE =
	'This item was already submitted in an earlier attempt of this run. Check the post in PostSider before retrying.';

interface RetryCacheEntry {
	fingerprint: string;
	date: string;
	media: PostSiderMedia[];
}

/**
 * Retry On Fail re-runs the item with the same derived Idempotency-Key. The backend hashes the whole
 * body per key, so a retry must send a byte-identical body: same resolved date (now, slot) and the
 * same uploaded media. Module-level and bounded; only derived keys use it.
 */
const retryCache = new Map<string, RetryCacheEntry>();

function isConflict(attempt: { value: unknown } | { error: unknown }, text: string): boolean {
	if (!('error' in attempt) || httpStatusOf(attempt.error) !== 409) return false;
	const failure = attempt.error as { message?: string; description?: unknown } | undefined;
	return `${failure?.message ?? ''} ${String(failure?.description ?? '')}`.includes(text);
}

/** The 409 for a reused key, with a description that tells the user what to change. */
function keyReusedError(node: INode, error: unknown, itemIndex: number): NodeApiError {
	if (error instanceof NodeApiError) {
		error.message = KEY_REUSED_MESSAGE;
		error.description = KEY_REUSED_DESCRIPTION;
		return error;
	}
	return new NodeApiError(node, error as JsonObject, {
		httpCode: '409',
		message: KEY_REUSED_MESSAGE,
		description: KEY_REUSED_DESCRIPTION,
		itemIndex,
	});
}

export function resetPublishCache(): void {
	retryCache.clear();
}

function rememberAttempt(key: string, entry: RetryCacheEntry): void {
	retryCache.delete(key);
	retryCache.set(key, entry);
	while (retryCache.size > CACHE_MAX_ENTRIES) {
		const oldest = retryCache.keys().next().value;
		if (oldest === undefined) break;
		retryCache.delete(oldest);
	}
}

export function clampWaitSeconds(timeoutSeconds: number): number {
	return Math.min(
		WAIT_MAX_SECONDS,
		Math.max(WAIT_MIN_SECONDS, Number.isFinite(timeoutSeconds) ? timeoutSeconds : 60),
	);
}

export function defaultIdempotencyKey(
	node: INode,
	supplied: string,
	/** `executionScope(ctx)`: instance, workflow and execution. */
	scope: string,
	itemIndex: number,
	runIndex = 0,
): string {
	const token = nodeToken(node.name);
	return validateIdempotencyKey(
		node,
		supplied.trim() || `n8n:${scope}:${token ? `${token}:` : ''}run${runIndex}:item:${itemIndex}`,
	);
}

export function resolvePublishDate(
	node: INode,
	when: PublishWhen,
	date: string | undefined,
	now: Date,
	slot?: unknown,
	/** Time zone for a date without one: the workflow time zone from node version 2.1, UTC before. */
	zone?: string,
): string {
	if (when === 'schedule') {
		const value = String(date ?? '').trim();
		if (!value) throw new NodeOperationError(node, "'Date' is required to schedule a post");
		return normalizeScheduledDate(node, value, 'Date', zone);
	}
	if (when === 'nextSlot') {
		const slotDate = (slot as { date?: unknown } | undefined)?.date;
		if (typeof slotDate !== 'string' || !slotDate) {
			throw new NodeOperationError(node, 'PostSider returned no free slot for this channel');
		}
		// find-slot returns a zone-less UTC wall-clock string; normalize treats it as UTC.
		return normalizeScheduledDate(node, slotDate, 'Next Free Slot');
	}
	return now.toISOString();
}

/**
 * Two allowed shapes: one settings object for every channel, or an object keyed only by channel ids
 * known in the workspace (values are settings objects). Keys of channels that are not selected are
 * ignored. Mixing channel ids with other keys is an error.
 */
function settingsFor(
	node: INode,
	settingsJson: Record<string, unknown>,
	channelId: string,
	knownIds: string[],
): Record<string, unknown> {
	const keys = Object.keys(settingsJson);
	const idKeys = keys.filter((key) => knownIds.includes(key));
	if (idKeys.length === 0) return settingsJson;
	const keyed =
		idKeys.length === keys.length &&
		idKeys.every(
			(key) =>
				settingsJson[key] !== null &&
				typeof settingsJson[key] === 'object' &&
				!Array.isArray(settingsJson[key]),
		);
	if (!keyed) {
		throw new NodeOperationError(
			node,
			"'Settings JSON' must be either one settings object applied to every channel, or an object keyed only by channel ID whose values are settings objects. It mixes channel IDs with other keys.",
		);
	}
	return (settingsJson[channelId] as Record<string, unknown> | undefined) ?? {};
}

function validateThreadParts(node: INode, parts: ThreadPartInput[]): Array<{ content: string; delay?: number }> {
	return parts.map((part, position) => {
		const number = position + 1;
		if (!String(part.text ?? '').trim()) {
			throw new NodeOperationError(node, `Thread part ${number} needs text`);
		}
		const delay = Number(part.delayMinutes ?? 0);
		if (!Number.isInteger(delay) || delay < 0 || delay > THREAD_DELAY_MAX_MINUTES) {
			throw new NodeOperationError(
				node,
				`Thread part ${number} delay must be a whole number of minutes from 0 to ${THREAD_DELAY_MAX_MINUTES}`,
			);
		}
		return { content: String(part.text), delay };
	});
}

export function buildPublishRequest(
	node: INode,
	input: PublishInput,
	providers: Record<string, string>,
	resolvedDate: string,
): OperationRequest {
	const thread = validateThreadParts(node, input.threadParts ?? []);
	const channels: ChannelPostInput[] = input.channels.map((channelId) => {
		const provider = providers[channelId];
		if (!provider) {
			throw new NodeOperationError(
				node,
				`Channel ${channelId} is not connected to this PostSider workspace`,
			);
		}
		const text = input.perChannelText[channelId] ?? input.text;
		if (!text.trim() && input.media.length === 0) {
			throw new NodeOperationError(
				node,
				`Channel ${channelId} needs text or media. Set 'Text' or add 'Media'.`,
			);
		}
		const settings = buildChannelSettings(
			provider,
			text,
			input.platform,
			settingsFor(node, input.settingsJson, channelId, Object.keys(providers)),
		);
		const titleLength = String(settings.title ?? '').trim().length;
		if (provider === 'youtube' && (titleLength < YOUTUBE_TITLE_MIN || titleLength > YOUTUBE_TITLE_MAX)) {
			throw new NodeOperationError(
				node,
				"YouTube needs a title of 2 to 100 characters. Set 'Options' > 'Platform Settings' > 'Title'.",
			);
		}
		return {
			channelId,
			content: text,
			...(input.firstComment ? { firstComment: input.firstComment } : {}),
			media: input.media,
			...(thread.length > 0 ? { thread } : {}),
			settings,
		};
	});
	return {
		method: 'POST',
		endpoint: '/posts',
		input: {
			body: buildCreatePostBody({
				type: input.when === 'nextSlot' ? 'schedule' : input.when,
				date: resolvedDate,
				shortLink: input.shortLink,
				tags: input.tags,
				channels,
			}) as unknown as IDataObject,
			headers: { 'Idempotency-Key': input.idempotencyKey },
		},
	};
}

/**
 * The create response is `[{ postId, integration, policy?, approvalRequested? }]` (policy fields are
 * absent on installs without the control plane). It carries no state, so the caller passes the state
 * the post starts in; a channel routed to approval is stored as a draft whatever was requested.
 */
export function summarizeCreated(
	response: unknown,
	channelNames: Record<string, string>,
	initialState: string,
	publishDate: string,
): IDataObject[] {
	const list = Array.isArray(response) ? response : [];
	return list.map((entry) => {
		const raw = (entry ?? {}) as Record<string, unknown>;
		const channelId = String(raw.integration ?? '');
		const approvalRequested = raw.approvalRequested === true;
		return {
			postId: String(raw.postId ?? ''),
			group: null,
			channelId,
			channelName: channelNames[channelId] ?? null,
			state: approvalRequested ? 'DRAFT' : initialState,
			publishDate,
			releaseURL: null,
			error: null,
			approvalRequested,
			policy: (raw.policy ?? null) as IDataObject | null,
		};
	});
}

const FINAL_STATES = new Set(['PUBLISHED', 'ERROR', 'DRAFT', 'APPROVAL', 'HELD']);

export async function waitForResult(
	api: ApiCall,
	rows: IDataObject[],
	timeoutSeconds: number,
	sleepFn: (ms: number) => Promise<void> = sleep,
	intervalMs = DEFAULT_WAIT_INTERVAL_MS,
): Promise<IDataObject[]> {
	const result = rows.map((row) => ({ ...row }));
	const limitMs = clampWaitSeconds(timeoutSeconds) * 1000;
	const isPending = (row: IDataObject) =>
		!FINAL_STATES.has(String(row.state)) && row.approvalRequested !== true && !!row.postId;
	let elapsed = 0;
	for (;;) {
		// Set when PostSider answers 429: the next round waits at least this long.
		let rateLimitWaitMs = 0;
		for (const row of result.filter(isPending)) {
			try {
				const detail = await api<{ group?: string; posts?: Array<Record<string, unknown>> }>(
					'GET',
					`/posts/${encodeURIComponent(String(row.postId))}`,
					// This loop waits out a 429 itself, against the wait timeout.
					{ rateLimitRetry: false },
				);
				const post = detail.posts?.find((p) => p.id === row.postId) ?? detail.posts?.[0];
				if (!post) continue;
				row.group = detail.group ?? (row.group as string | null);
				row.state = String(post.state ?? row.state);
				if (post.publishDate) row.publishDate = String(post.publishDate);
				if (post.releaseURL) row.releaseURL = String(post.releaseURL);
				if (post.error) row.error = String(post.error);
			} catch (error) {
				const status = httpStatusOf(error);
				if (status === 429) {
					// Too many requests is not a failed post. Stop polling this round and wait it out.
					rateLimitWaitMs = Math.max(intervalMs, retryAfterMsOf(error) ?? 0);
					break;
				}
				if (status !== undefined && status >= 400 && status < 500) {
					const message = (error as Error).message;
					for (const pending of result.filter(isPending)) pending.pollError = message;
					return result;
				}
				// 5xx and network errors are not a failed post; try again on the next round.
			}
		}
		if (!result.some(isPending)) return result;
		const waitMs = Math.max(intervalMs, rateLimitWaitMs);
		if (elapsed + waitMs > limitMs) {
			for (const row of result.filter(isPending)) row.timedOut = true;
			return result;
		}
		await sleepFn(waitMs);
		elapsed += waitMs;
	}
}

interface Integration {
	id: string;
	name?: string;
	identifier?: string;
}

export type IntegrationCache = { value?: Integration[] };

async function loadIntegrations(
	ctx: IExecuteFunctions,
	cache: IntegrationCache,
): Promise<Integration[]> {
	if (!cache.value) {
		cache.value = await (postSiderApiRequest<Integration[]>).call(ctx, 'GET', '/integrations');
	}
	return cache.value;
}

function collectPlatform(raw: IDataObject): PlatformSettingsInput {
	return { ...raw } as PlatformSettingsInput;
}

export async function executePublish(
	ctx: IExecuteFunctions,
	index: number,
	cache: IntegrationCache,
	now: () => Date = () => new Date(),
	sleepFn: (ms: number) => Promise<void> = sleep,
): Promise<IDataObject[]> {
	const node = ctx.getNode();
	const api: ApiCall = (method, endpoint, input) =>
		postSiderApiRequest.call(ctx, method, endpoint, input) as never;
	const get = (name: string, fallback?: unknown) => ctx.getNodeParameter(name, index, fallback);

	const binaryLabel = binaryFieldLabel(isCurrent(ctx));
	const zone = dateZone(ctx);
	const channels = parseIdList(node, get('channels', []), 'Channel Names or IDs');
	const text = String(get('text', ''));
	const when = String(get('when', 'now')) as PublishWhen;
	const options = get('options', {}) as IDataObject;

	const integrations = await loadIntegrations(ctx, cache);
	const providers: Record<string, string> = {};
	const names: Record<string, string> = {};
	for (const integration of integrations) {
		providers[integration.id] = String(integration.identifier ?? '');
		names[integration.id] = String(integration.name ?? '');
	}
	for (const id of channels) {
		if (!providers[id]) {
			throw new NodeOperationError(
				node,
				`Channel ${id} is not connected to this PostSider workspace`,
				{ itemIndex: index },
			);
		}
	}

	// Pure input parsing and validation first: nothing below may cost an upload or a slot lookup.
	const mediaSource = String(get('mediaSource', 'none'));
	let binaryNames: string[] = [];
	let mediaUrls: string[] = [];
	let media: PostSiderMedia[] = [];
	let mediaCount = 0;
	if (mediaSource === 'binary') {
		binaryNames = parseIdList(node, get('binaryProperties', 'data'), binaryLabel);
		mediaCount = binaryNames.length;
	} else if (mediaSource === 'url') {
		mediaUrls = parseUrlList(node, get('mediaUrls', ''));
		if (mediaUrls.length === 0) {
			throw new NodeOperationError(node, "'Media URLs' must list at least one URL", { itemIndex: index });
		}
		mediaCount = mediaUrls.length;
	} else if (mediaSource === 'uploaded') {
		media = parseMediaJson(node, get('mediaJson', '[]'));
		mediaCount = media.length;
	}

	const perChannelText: Record<string, string> = {};
	const overrides = ((options.perChannelText as IDataObject | undefined)?.override ?? []) as Array<{
		channelId?: string;
		text?: string;
	}>;
	for (const override of overrides) {
		if (override.channelId) perChannelText[override.channelId] = String(override.text ?? '');
	}
	const rawSettings = options.settingsJson;
	const settingsJson =
		rawSettings === undefined || rawSettings === '' || rawSettings === null
			? {}
			: typeof rawSettings === 'string'
				? parseJsonObject(node, rawSettings, 'Settings JSON')
				: (rawSettings as Record<string, unknown>);
	const tags = (((options.tags as IDataObject | undefined)?.tag ?? []) as PostSiderTag[]).filter(
		(tag) => tag && tag.value,
	);
	const threadParts = (
		((options.threadParts as IDataObject | undefined)?.part ?? []) as Array<{
			text?: unknown;
			delayMinutes?: unknown;
		}>
	).map((part) => ({
		text: String(part?.text ?? ''),
		delayMinutes: Number(part?.delayMinutes ?? 0),
	}));
	const derivedKey = String(options.idempotencyKey ?? '').trim() === '';
	const idempotencyKey = defaultIdempotencyKey(
		node,
		String(options.idempotencyKey ?? ''),
		executionScope(ctx),
		index,
		runIndexOf(ctx, index),
	);
	const base: Omit<PublishInput, 'media' | 'date'> = {
		channels,
		text,
		when,
		firstComment: options.firstComment ? String(options.firstComment) : undefined,
		perChannelText,
		platform: collectPlatform((options.platformSettings ?? {}) as IDataObject),
		settingsJson,
		tags,
		shortLink: Boolean(options.shortLink),
		idempotencyKey,
		threadParts,
	};
	const scheduleDate =
		when === 'schedule' ? resolvePublishDate(node, when, String(get('date', '')), now(), undefined, zone) : undefined;
	// Dry build with placeholder media so text, title and settings errors surface before any API call.
	buildPublishRequest(
		node,
		{ ...base, media: Array.from({ length: mediaCount }, (_, n) => ({ id: `${n}`, path: '' })) },
		providers,
		scheduleDate ?? now().toISOString(),
	);

	const fingerprint = JSON.stringify([
		channels,
		text,
		when,
		get('date', ''),
		mediaSource,
		binaryNames,
		mediaUrls,
		media,
		options,
	]);
	const cached = derivedKey ? retryCache.get(idempotencyKey) : undefined;
	let date: string;
	if (cached && cached.fingerprint === fingerprint) {
		media = cached.media;
		date = cached.date;
	} else {
		if (mediaSource === 'binary') media = await uploadBinaries(ctx, api, index, binaryNames, binaryLabel);
		else if (mediaSource === 'url') media = await uploadFromUrls(node, api, mediaUrls);

		let slot: unknown;
		if (when === 'nextSlot') {
			slot = await api<unknown>('GET', `/find-slot/${encodeURIComponent(channels[0])}`);
		}
		date = scheduleDate ?? resolvePublishDate(node, when, undefined, now(), slot);
	}
	if (derivedKey) rememberAttempt(idempotencyKey, { fingerprint, date, media });

	const request = buildPublishRequest(node, { ...base, media }, providers, date);

	// Keep the original error: executeV2 wraps it (NodeApiError or NodeOperationError) for every operation.
	const send = () =>
		api<unknown>(request.method, request.endpoint, request.input).then(
			(value) => ({ value }),
			(error: unknown) => ({ error }),
		);
	// A derived key that this process has used before means this run already sent the post once.
	const sentBefore = derivedKey && cached !== undefined;
	let attempt = await send();
	// An earlier attempt may still be running on the server: wait for it and send the same body again,
	// which PostSider answers with the first result once that attempt has finished.
	for (let wait = 0; wait < PROCESSING_RETRIES && sentBefore && isConflict(attempt, PROCESSING_TEXT); wait++) {
		await sleepFn(PROCESSING_WAIT_MS);
		attempt = await send();
	}
	if ('error' in attempt) {
		if (
			sentBefore &&
			(isConflict(attempt, CONFLICT_TEXT) || isConflict(attempt, PROCESSING_TEXT))
		) {
			return channels.map((channelId) => ({
				channelId,
				channelName: names[channelId] ?? null,
				state: 'UNKNOWN',
				alreadySubmitted: true,
				idempotencyKey,
				message: ALREADY_SUBMITTED_MESSAGE,
			}));
		}
		if (isConflict(attempt, CONFLICT_TEXT)) throw keyReusedError(node, attempt.error, index);
		throw attempt.error;
	}
	const response = attempt.value;
	if (!Array.isArray(response)) {
		throw new NodeOperationError(
			node,
			`PostSider returned an unexpected response when creating the post: ${JSON.stringify(response)?.slice(0, 500) ?? String(response)}`,
			{ itemIndex: index },
		);
	}
	let rows = summarizeCreated(response, names, when === 'draft' ? 'DRAFT' : 'QUEUE', date);
	if (options.waitForResult && (when === 'now' || when === 'nextSlot')) {
		const timeout = Number(options.waitTimeout ?? 60);
		if (when === 'nextSlot' && Date.parse(date) > now().getTime() + clampWaitSeconds(timeout) * 1000) {
			rows = rows.map((row) => ({ ...row, waitSkipped: 'slot is later than the wait timeout' }));
		} else {
			rows = await waitForResult(api, rows, timeout, sleepFn);
		}
	}
	return rows;
}
