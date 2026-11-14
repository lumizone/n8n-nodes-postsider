import type { INode, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

export const MISSING_ROUTE_MESSAGE = 'This operation is not available on this PostSider server';
export const MISSING_ROUTE_DESCRIPTION =
	'The PostSider server you are connected to does not offer this feature.';

const MISSING_ROUTE_PATTERN = /Cannot (?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \//;

/** Integer HTTP status of an error: `statusCode` on plain errors, `httpCode` (string) on NodeApiError. */
export function httpStatusOf(error: unknown): number | undefined {
	const raw = error as { statusCode?: unknown; httpCode?: unknown } | undefined;
	const value = raw?.statusCode ?? raw?.httpCode;
	// Number(null) and Number('') are 0, which is not a status.
	if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
		return undefined;
	}
	const status = Number(value);
	return Number.isInteger(status) ? status : undefined;
}

type Loose = Record<string, unknown> | undefined;

function asLoose(value: unknown): Loose {
	return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

/** Retry-After in milliseconds (seconds form only), read from the places an HTTP error keeps headers. */
export function retryAfterMsOf(error: unknown): number | undefined {
	const sources = [error, asLoose(error)?.cause].map(asLoose);
	for (const source of sources) {
		const headers = asLoose(asLoose(source?.response)?.headers) ?? asLoose(source?.headers);
		if (!headers) continue;
		const key = Object.keys(headers).find((name) => name.toLowerCase() === 'retry-after');
		const seconds = key === undefined ? NaN : Number(headers[key]);
		if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
	}
	return undefined;
}

function textsOf(error: unknown): string[] {
	const found: string[] = [];
	const add = (value: unknown) => {
		if (typeof value === 'string') found.push(value);
		else if (Array.isArray(value)) value.forEach(add);
	};
	const raw = asLoose(error);
	if (!raw) return found;
	add(raw.message);
	add(raw.description);
	add(raw.messages);
	for (const nested of [raw.context, raw.response, raw.error, raw.cause]) {
		const object = asLoose(nested);
		add(object?.message);
		const data = asLoose(object?.data) ?? asLoose(object?.body);
		add(data?.message);
	}
	return found;
}

/**
 * The server answers an unknown route with 404 and "Cannot GET /public/v1/...". That means the server
 * is older than the node, not that a resource is missing, so say so.
 */
export function missingRouteError(node: INode, error: unknown): NodeApiError | undefined {
	if (httpStatusOf(error) !== 404) return undefined;
	if (!textsOf(error).some((text) => MISSING_ROUTE_PATTERN.test(text))) return undefined;
	return new NodeApiError(node, { message: MISSING_ROUTE_MESSAGE } as JsonObject, {
		message: MISSING_ROUTE_MESSAGE,
		description: MISSING_ROUTE_DESCRIPTION,
		httpCode: '404',
	});
}

/** The object a body holds: an object as it is, or the parsed JSON of a string that holds one. */
function bodyObject(value: unknown): Loose {
	if (typeof value === 'string') {
		const text = value.trim();
		if (!text.startsWith('{')) return undefined;
		try {
			return asLoose(JSON.parse(text));
		} catch {
			return undefined;
		}
	}
	return asLoose(value);
}

function nonEmpty(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

export const PAUSED_MESSAGE = 'Publishing is paused in PostSider';
export const PAUSED_DESCRIPTION = 'Resume publishing in the PostSider dashboard.';

export interface ServerDetail {
	/** The reason PostSider gave. */
	description: string;
	/** Replaces n8n's status message when PostSider's own wording is clearer. */
	message?: string;
}

/** What one error body says, in the three shapes the PostSider API uses. */
function detailOfBody(value: unknown): ServerDetail | undefined {
	const body = bodyObject(value);
	if (!body) return undefined;
	// 423 `{ error: 'publishing_paused', reason }`
	if (body.error === 'publishing_paused') {
		return { message: PAUSED_MESSAGE, description: nonEmpty(body.reason) ?? PAUSED_DESCRIPTION };
	}
	// Most errors: `{ msg }`
	const msg = nonEmpty(body.msg);
	if (msg) return { description: msg };
	// Post validation errors: `{ statusCode, provider, name, message }`
	const name = nonEmpty(body.name);
	const message = nonEmpty(body.message);
	if (name && message) return { description: `${name}: ${message}` };
	return undefined;
}

/**
 * The reason PostSider put in the body of an error answer. Depending on how n8n or the HTTP library
 * wrapped the failure, the body is in one of several places; Nest's own `{ message }` bodies are not read
 * here because n8n already uses them.
 */
export function serverDetailOf(error: unknown): ServerDetail | undefined {
	const raw = asLoose(error);
	if (!raw) return undefined;
	const cause = asLoose(raw.cause);
	const candidates: unknown[] = [
		asLoose(raw.context)?.data,
		asLoose(cause?.response)?.data,
		asLoose(raw.response)?.data,
		asLoose(raw.response)?.body,
		raw.error,
		raw.description,
	];
	for (const candidate of candidates) {
		const detail = detailOfBody(candidate);
		if (detail) return detail;
	}
	return undefined;
}

/** The text of the server detail (`msg`, `name: message` or the pause reason). */
export function serverMessageOf(error: unknown): string | undefined {
	return serverDetailOf(error)?.description;
}

/**
 * Puts the server message of an HTTP error into the error description, and keeps n8n's status message
 * (for example 'Bad request - please check your parameters') as the message. Returns undefined when the
 * error has no HTTP status or no readable body, so the caller keeps the original error.
 *
 * A NodeApiError is changed in place: n8n returns the original when one is wrapped again, and the original
 * keeps the response headers that Wait for Result reads (Retry-After). Any other error becomes a
 * NodeApiError for the same node, with the original as its cause.
 */
export function withServerMessage(node: INode, error: unknown): NodeApiError | undefined {
	const status = httpStatusOf(error);
	if (status === undefined) return undefined;
	const detail = serverDetailOf(error);
	if (!detail) return undefined;
	if (error instanceof NodeApiError) {
		error.description = detail.description;
		if (detail.message) error.message = detail.message;
		return error;
	}
	const wrapped = new NodeApiError(node, error as JsonObject, { httpCode: String(status) });
	// A body with a `message` as well would otherwise take the place of the server's detail.
	wrapped.description = detail.description;
	if (detail.message) wrapped.message = detail.message;
	return wrapped;
}

/**
 * The error to throw for a failed item. An error that is already a NodeApiError or NodeOperationError is
 * kept as it is (wrapping it again would drop the item index) and only gets `context.itemIndex`. Other
 * errors become a NodeApiError when they carry an HTTP status, otherwise a NodeOperationError.
 */
export function toNodeError(
	node: INode,
	error: unknown,
	itemIndex?: number,
): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) {
		if (itemIndex !== undefined) error.context.itemIndex = itemIndex;
		return error;
	}
	const options = itemIndex === undefined ? {} : { itemIndex };
	if (httpStatusOf(error) !== undefined) {
		return new NodeApiError(node, error as JsonObject, options);
	}
	return new NodeOperationError(node, error as Error, options);
}

/**
 * The JSON of an item that failed while 'Continue On Fail' is on: the error message and, when PostSider
 * gave a reason (for example 'Publishing is paused'), that reason as `description`.
 */
export function continueOnFailJson(error: unknown): { error: string; description?: string } {
	const message = String((error as Error | undefined)?.message ?? error);
	const raw = (error as { description?: unknown } | undefined)?.description;
	const description = typeof raw === 'string' && raw.trim() !== '' && raw !== message ? raw : undefined;
	return description ? { error: message, description } : { error: message };
}
