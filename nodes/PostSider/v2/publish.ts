import type { IDataObject, IExecuteFunctions, INode } from 'n8n-workflow';
import { NodeOperationError, sleep } from 'n8n-workflow';

import {
	buildCreatePostBody,
	normalizeScheduledDate,
	parseJsonObject,
	type ChannelPostInput,
	type PostSiderMedia,
	type PostSiderTag,
} from '../shared/payloads';
import { validateIdempotencyKey, type OperationRequest } from '../shared/operations';
import { postSiderApiRequest } from '../shared/transport';
import { parseIdList, parseMediaJson, parseUrlList } from './inputs';
import { uploadBinaries, uploadFromUrls, type ApiCall } from './media';
import { buildChannelSettings, type PlatformSettingsInput } from './platformSettings';

export type PublishWhen = 'now' | 'schedule' | 'nextSlot' | 'draft';

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
}

const YOUTUBE_TITLE_MIN = 2;
const DEFAULT_WAIT_INTERVAL_MS = 5000;

export function defaultIdempotencyKey(
	node: INode,
	supplied: string,
	executionId: string,
	itemIndex: number,
): string {
	return validateIdempotencyKey(node, supplied.trim() || `n8n:${executionId}:item:${itemIndex}`);
}

export function resolvePublishDate(
	node: INode,
	when: PublishWhen,
	date: string | undefined,
	now: Date,
	slot?: unknown,
): string {
	if (when === 'schedule') {
		const value = String(date ?? '').trim();
		if (!value) throw new NodeOperationError(node, 'Date is required to schedule a post');
		return normalizeScheduledDate(node, value);
	}
	if (when === 'nextSlot') {
		const slotDate = (slot as { date?: unknown } | undefined)?.date;
		if (typeof slotDate !== 'string' || !slotDate) {
			throw new NodeOperationError(node, 'PostSider returned no free slot for this channel');
		}
		return slotDate;
	}
	return now.toISOString();
}

/** Keyed form: every top-level key is a selected channel id and every value is an object. */
function settingsFor(
	settingsJson: Record<string, unknown>,
	channelId: string,
	channels: string[],
): Record<string, unknown> {
	const keys = Object.keys(settingsJson);
	const keyed =
		keys.length > 0 &&
		keys.every(
			(key) =>
				channels.includes(key) &&
				settingsJson[key] !== null &&
				typeof settingsJson[key] === 'object' &&
				!Array.isArray(settingsJson[key]),
		);
	if (!keyed) return settingsJson;
	return (settingsJson[channelId] as Record<string, unknown> | undefined) ?? {};
}

export function buildPublishRequest(
	node: INode,
	input: PublishInput,
	providers: Record<string, string>,
	resolvedDate: string,
): OperationRequest {
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
				`Channel ${channelId} needs text or media. Set Text or add Media.`,
			);
		}
		const settings = buildChannelSettings(
			provider,
			text,
			input.platform,
			settingsFor(input.settingsJson, channelId, input.channels),
		);
		if (provider === 'youtube' && String(settings.title ?? '').trim().length < YOUTUBE_TITLE_MIN) {
			throw new NodeOperationError(
				node,
				'YouTube needs a title of 2 to 100 characters. Set Options > Platform Settings > Title.',
			);
		}
		return {
			channelId,
			content: text,
			...(input.firstComment ? { firstComment: input.firstComment } : {}),
			media: input.media,
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

const FINAL_STATES = new Set(['PUBLISHED', 'ERROR']);

export async function waitForResult(
	api: ApiCall,
	rows: IDataObject[],
	timeoutSeconds: number,
	sleepFn: (ms: number) => Promise<void> = sleep,
	intervalMs = DEFAULT_WAIT_INTERVAL_MS,
): Promise<IDataObject[]> {
	const result = rows.map((row) => ({ ...row }));
	const isPending = (row: IDataObject) =>
		!FINAL_STATES.has(String(row.state)) && row.approvalRequested !== true && !!row.postId;
	let elapsed = 0;
	for (;;) {
		for (const row of result.filter(isPending)) {
			try {
				const detail = await api<{ group?: string; posts?: Array<Record<string, unknown>> }>(
					'GET',
					`/posts/${encodeURIComponent(String(row.postId))}`,
				);
				const post = detail.posts?.find((p) => p.id === row.postId) ?? detail.posts?.[0];
				if (!post) continue;
				row.group = detail.group ?? (row.group as string | null);
				row.state = String(post.state ?? row.state);
				if (post.publishDate) row.publishDate = String(post.publishDate);
				if (post.releaseURL) row.releaseURL = String(post.releaseURL);
				if (post.error) row.error = String(post.error);
			} catch {
				// A failed poll is not a failed post; try again on the next round.
			}
		}
		if (!result.some(isPending)) return result;
		if (elapsed + intervalMs > timeoutSeconds * 1000) {
			for (const row of result.filter(isPending)) row.timedOut = true;
			return result;
		}
		await sleepFn(intervalMs);
		elapsed += intervalMs;
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

	const channels = parseIdList(node, get('channels', []), 'Channels');
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

	const mediaSource = String(get('mediaSource', 'none'));
	let media: PostSiderMedia[] = [];
	if (mediaSource === 'binary') {
		const names = parseIdList(node, get('binaryProperties', 'data'), 'Binary property names');
		media = await uploadBinaries(ctx, api, index, names);
	} else if (mediaSource === 'url') {
		media = await uploadFromUrls(api, parseUrlList(node, get('mediaUrls', '')));
	} else if (mediaSource === 'uploaded') {
		media = parseMediaJson(node, get('mediaJson', '[]'));
	}

	let slot: unknown;
	if (when === 'nextSlot') {
		slot = await api<unknown>('GET', `/find-slot/${encodeURIComponent(channels[0])}`);
	}
	const date = resolvePublishDate(
		node,
		when,
		when === 'schedule' ? String(get('date', '')) : undefined,
		now(),
		slot,
	);

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

	const request = buildPublishRequest(
		node,
		{
			channels,
			text,
			when,
			date,
			media,
			firstComment: options.firstComment ? String(options.firstComment) : undefined,
			perChannelText,
			platform: collectPlatform((options.platformSettings ?? {}) as IDataObject),
			settingsJson,
			tags,
			shortLink: Boolean(options.shortLink),
			idempotencyKey: defaultIdempotencyKey(
				node,
				String(options.idempotencyKey ?? ''),
				ctx.getExecutionId(),
				index,
			),
		},
		providers,
		date,
	);

	const response = await api<unknown>(request.method, request.endpoint, request.input);
	let rows = summarizeCreated(response, names, when === 'draft' ? 'DRAFT' : 'QUEUE', date);
	if (options.waitForResult && (when === 'now' || when === 'nextSlot')) {
		const timeout = Number(options.waitTimeout ?? 60);
		rows = await waitForResult(api, rows, timeout > 0 ? timeout : 60, sleepFn);
	}
	return rows;
}
