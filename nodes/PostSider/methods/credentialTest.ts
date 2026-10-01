import type {
	ICredentialTestFunction,
	ICredentialTestFunctions,
	INodeCredentialTestResult,
} from 'n8n-workflow';

import { normalizeApiBaseUrl } from '../shared/transport';

export const postSiderCredentialTest: ICredentialTestFunction = async function (
	this: ICredentialTestFunctions,
	credential,
): Promise<INodeCredentialTestResult> {
	const data = credential.data ?? {};
	const apiKey = String(data.apiKey ?? '');

	try {
		const baseUrl = normalizeApiBaseUrl(String(data.baseUrl ?? ''));
		// ICredentialTestFunctions currently exposes only the legacy request helper.
		// eslint-disable-next-line @n8n/community-nodes/no-deprecated-workflow-functions
		await this.helpers.request({
			method: 'GET',
			uri: `${baseUrl}/is-connected`,
			headers: { Authorization: apiKey },
			json: true,
			timeout: 30000,
			followRedirect: false,
			followAllRedirects: false,
		});
		return { status: 'OK', message: 'Connection successful' };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Connection failed';
		const safeMessage = apiKey ? message.split(apiKey).join('[REDACTED]') : message;
		return { status: 'Error', message: safeMessage };
	}
};
