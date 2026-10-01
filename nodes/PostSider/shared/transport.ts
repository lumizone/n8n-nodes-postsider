import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
} from 'n8n-workflow';

type PostSiderFunctions = IExecuteFunctions | ILoadOptionsFunctions;

interface RequestInput {
	body?: IDataObject | IDataObject[];
	qs?: IDataObject;
	headers?: IDataObject;
}

function isLoopback(hostname: string): boolean {
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function normalizeApiBaseUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error('Base URL must be a valid absolute URL');
	}
	if (url.username || url.password) {
		throw new Error('Base URL must not include credentials');
	}
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
		throw new Error('Base URL must use HTTPS unless it points to a local development server');
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
	return {
		method,
		url,
		...(method === 'GET' || method === 'HEAD' ? {} : input.body ? { body: input.body } : {}),
		...(input.qs ? { qs: input.qs } : {}),
		...(input.headers ? { headers: input.headers } : {}),
		json: true,
		timeout: 30000,
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
	const baseUrl = normalizeApiBaseUrl(String(credentials.baseUrl));
	const options = buildRequestOptions(method, `${baseUrl}${endpoint}`, input);
	return (await this.helpers.httpRequestWithAuthentication.call(
		this,
		'postSiderApi',
		options,
	)) as T;
}
