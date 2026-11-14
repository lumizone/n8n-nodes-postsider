import type { INode, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

export const MISSING_ROUTE_MESSAGE = 'This operation is not available on this PostSider server';
export const MISSING_ROUTE_DESCRIPTION =
	'The server has no route for this request. Update the PostSider server to version 2026-11 or newer.';

const MISSING_ROUTE_PATTERN = /Cannot (?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \//;

/** Integer HTTP status of an error: `statusCode` on plain errors, `httpCode` (string) on NodeApiError. */
export function httpStatusOf(error: unknown): number | undefined {
	const raw = error as { statusCode?: unknown; httpCode?: unknown } | undefined;
	const status = Number(raw?.statusCode ?? raw?.httpCode);
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
