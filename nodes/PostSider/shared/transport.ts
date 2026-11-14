import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IPollFunctions,
	INode,
} from 'n8n-workflow';
import { NodeOperationError, sleep } from 'n8n-workflow';

import { httpStatusOf, missingRouteError, retryAfterMsOf, withServerMessage } from './errors';

type PostSiderFunctions = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions;

export interface RequestInput {
	body?: IDataObject | IDataObject[];
	/** Multipart body; sent as-is so the runtime sets the boundary header. */
	formData?: FormData;
	/** Overrides the default 30 s timeout (large uploads, Post Check, Post Rewrite, Channel Get Options). */
	timeout?: number;
	qs?: IDataObject;
	headers?: IDataObject;
	/** Set to false when the caller waits out 429 answers itself (Wait for Result). */
	rateLimitRetry?: boolean;
}

/** Retries after a 429 answer, the wait when PostSider sends no Retry-After, and the longest single wait. */
export const RATE_LIMIT_MAX_RETRIES = 3;
export const RATE_LIMIT_DEFAULT_WAIT_MS = 5000;
export const RATE_LIMIT_MAX_WAIT_MS = 60000;

/** The wait function of the transport; replaced in tests so no real time passes. */
export const transportClock: { sleep: (ms: number) => Promise<void> } = { sleep };

/** Default request timeout. */
export const DEFAULT_TIMEOUT_MS = 30000;
/** Post Check, Post Rewrite and Channel Get Options call AI or platform APIs and can take much longer. */
export const SLOW_REQUEST_TIMEOUT_MS = 120000;

function isLoopback(hostname: string): boolean {
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function normalizeApiBaseUrl(node: INode, value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new NodeOperationError(node, "'Base URL' must be a valid absolute URL");
	}
	if (url.username || url.password) {
		throw new NodeOperationError(node, "'Base URL' must not include credentials");
	}
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
		throw new NodeOperationError(node, "'Base URL' must use HTTPS unless it points to a local development server");
	}
	url.search = '';
	url.hash = '';
	const path = url.pathname.replace(/\/+$/, '');
	url.pathname = path.endsWith('/public/v1') ? path : `${path}/public/v1`;
	return url.toString().replace(/\/$/, '');
}

export function buildRequestOptions(
	method: IHttpRequestMethods,
	url: string,
	input: RequestInput = {},
): IHttpRequestOptions {
	const hasBody = method !== 'GET' && method !== 'HEAD';
	return {
		method,
		url,
		...(hasBody && input.formData
			? { body: input.formData }
			: hasBody && input.body
				? { body: input.body }
				: {}),
		...(input.qs ? { qs: input.qs } : {}),
		...(input.headers ? { headers: input.headers } : {}),
		...(input.formData ? {} : { json: true }),
		timeout: input.timeout ?? DEFAULT_TIMEOUT_MS,
		disableFollowRedirect: true,
		sendCredentialsOnCrossOriginRedirect: false,
	};
}

/**
 * A 429 is repeated only when sending the request again cannot do any harm: a read (GET), or the creation
 * of a post (`POST /posts`) that carries an Idempotency-Key, which PostSider answers with the first result.
 */
function repeatsAfterRateLimit(method: IHttpRequestMethods, endpoint: string, input: RequestInput): boolean {
	if (input.rateLimitRetry === false) return false;
	if (method === 'GET') return true;
	return method === 'POST' && endpoint === '/posts' && Boolean(input.headers?.['Idempotency-Key']);
}

export async function postSiderApiRequest<T = IDataObject>(
	this: PostSiderFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	input: RequestInput = {},
): Promise<T> {
	const credentials = await this.getCredentials('postSiderApi');
	const baseUrl = normalizeApiBaseUrl(this.getNode(), String(credentials.baseUrl));
	const options = buildRequestOptions(method, `${baseUrl}${endpoint}`, input);
	for (let attempt = 0; ; attempt++) {
		try {
			return (await this.helpers.httpRequestWithAuthentication.call(
				this,
				'postSiderApi',
				options,
			)) as T;
		} catch (error) {
			if (
				httpStatusOf(error) === 429 &&
				attempt < RATE_LIMIT_MAX_RETRIES &&
				repeatsAfterRateLimit(method, endpoint, input)
			) {
				const wait = retryAfterMsOf(error) ?? RATE_LIMIT_DEFAULT_WAIT_MS;
				await transportClock.sleep(Math.min(RATE_LIMIT_MAX_WAIT_MS, wait));
				continue;
			}
			throw missingRouteError(this.getNode(), error) ?? withServerMessage(this.getNode(), error) ?? error;
		}
	}
}
