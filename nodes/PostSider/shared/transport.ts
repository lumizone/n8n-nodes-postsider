import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IPollFunctions,
	INode,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { missingRouteError } from './errors';

type PostSiderFunctions = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions;

export interface RequestInput {
	body?: IDataObject | IDataObject[];
	/** Multipart body; sent as-is so the runtime sets the boundary header. */
	formData?: FormData;
	/** Overrides the default 30 s timeout (large uploads, Post Check, Post Rewrite, Channel Get Options). */
	timeout?: number;
	qs?: IDataObject;
	headers?: IDataObject;
}

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
		throw new NodeOperationError(node, 'Base URL must be a valid absolute URL');
	}
	if (url.username || url.password) {
		throw new NodeOperationError(node, 'Base URL must not include credentials');
	}
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
		throw new NodeOperationError(node, 'Base URL must use HTTPS unless it points to a local development server');
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

export async function postSiderApiRequest<T = IDataObject>(
	this: PostSiderFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	input: RequestInput = {},
): Promise<T> {
	const credentials = await this.getCredentials('postSiderApi');
	const baseUrl = normalizeApiBaseUrl(this.getNode(), String(credentials.baseUrl));
	const options = buildRequestOptions(method, `${baseUrl}${endpoint}`, input);
	try {
		return (await this.helpers.httpRequestWithAuthentication.call(
			this,
			'postSiderApi',
			options,
		)) as T;
	} catch (error) {
		throw missingRouteError(this.getNode(), error) ?? error;
	}
}
