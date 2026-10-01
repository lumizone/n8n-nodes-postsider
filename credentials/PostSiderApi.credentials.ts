import type {
	IAuthenticateGeneric,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class PostSiderApi implements ICredentialType {
	name = 'postSiderApi';
	displayName = 'PostSider API';
	icon = 'file:../nodes/PostSider/postsider.svg' as const;
	documentationUrl = 'https://docs.postsider.com/api/quickstart';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'Organization API key from Settings > API in PostSider',
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
				Authorization: '={{$credentials.apiKey}}',
			},
		},
	};

}
