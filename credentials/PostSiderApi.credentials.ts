import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class PostSiderApi implements ICredentialType {
	name = 'postSiderApi';
	displayName = 'PostSider API';
	icon = {
		light: 'file:../nodes/PostSider/postsider.svg',
		dark: 'file:../nodes/PostSider/postsider.dark.svg',
	} as const;
	documentationUrl = 'https://docs.postsider.com/security/authentication';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
			"Organization API key from Settings > API in PostSider. Paste the key without 'Bearer'.",
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.postsider.com',
			description:
				'PostSider API origin. For self-hosted installations behind the bundled proxy, include /api.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				// PostSider wants the bare key. A leading 'Bearer ' pasted by mistake would be rejected, so it is removed.
				Authorization: "={{ String($credentials.apiKey).trim().replace(/^Bearer\\s+/i, '') }}",
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL:
				"={{ String($credentials.baseUrl).replace(/\\/+$/, '').replace(/\\/public\\/v1$/, '') + '/public/v1' }}",
			url: '/is-connected',
			method: 'GET',
		},
	};
}
