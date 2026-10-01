import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { getChannels, getGroups } from './methods/loadOptions';
import { postSiderCredentialTest } from './methods/credentialTest';
import { fieldProperties, operationProperties, resourceProperty } from './resources/descriptions';
import {
	buildOperationRequest,
	normalizePostResponse,
	simplifyPostResponse,
} from './shared/operations';
import { postSiderApiRequest } from './shared/transport';

function getParameters(context: IExecuteFunctions, resource: string, operation: string, index: number) {
	const get = (name: string, fallback?: unknown) => context.getNodeParameter(name, index, fallback);
	if (resource === 'channel') return { groupId: get('groupId', '') };
	if (resource === 'group') return {};
	if (resource === 'media') return { url: get('url') };
	if (resource === 'scheduling') return { channelId: get('channelId') };
	if (resource === 'approval') return { postId: get('postId') };
	if (resource === 'post' && operation === 'create') {
		return {
			type: get('type'),
			publishDate: get('publishDate', ''),
			channelPosts: get('channelPosts'),
			shortLink: get('shortLink', false),
			tagsJson: get('tagsJson', '[]'),
			idempotencyKey: get('idempotencyKey', ''),
		};
	}
	if (resource === 'post' && operation === 'get') {
		return { postId: get('postId'), simplify: get('simplify', true) };
	}
	if (resource === 'post' && operation === 'getMany') {
		return {
			startDate: get('startDate'),
			endDate: get('endDate'),
			groupId: get('groupId', ''),
			simplify: get('simplify', true),
		};
	}
	return {};
}

function asObject(value: unknown): IDataObject {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return { value: value === null || value === undefined ? '' : String(value) };
	}
	return value as IDataObject;
}

function prepareOutput(
	resource: string,
	operation: string,
	response: unknown,
	simplify: boolean,
): IDataObject[] {
	const normalized = normalizePostResponse(response);
	if (resource === 'post' && operation === 'getMany') {
		const posts =
			normalized && typeof normalized === 'object' && !Array.isArray(normalized)
				? ((normalized as { posts?: unknown }).posts ?? [])
				: normalized;
		if (!Array.isArray(posts)) return [asObject(posts)];
		return posts.map((post) =>
			simplify && post && typeof post === 'object'
				? (simplifyPostResponse(post as Record<string, unknown>) as IDataObject)
				: asObject(post),
		);
	}
	if (resource === 'post' && operation === 'get' && simplify) {
		const detail = asObject(normalized);
		const posts = Array.isArray(detail.posts)
			? detail.posts.map((post) => simplifyPostResponse(post as Record<string, unknown>))
			: [];
		return [
			{
				group: detail.group,
				integration: detail.integration,
				integrationPicture: detail.integrationPicture,
				settings: detail.settings,
				posts,
			},
		];
	}
	if (Array.isArray(normalized)) return normalized.map(asObject);
	return [asObject(normalized)];
}

export class PostSider implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PostSider',
		name: 'postSider',
		icon: 'file:postsider.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Prepare, schedule, and review social media posts with PostSider',
		defaults: { name: 'PostSider' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'postSiderApi', required: true, testedBy: 'postSiderCredentialTest' }],
		properties: [resourceProperty, ...operationProperties, ...fieldProperties],
	};

	methods = {
		credentialTest: {
			postSiderCredentialTest,
		},
		loadOptions: {
			getChannels,
			getGroups,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		for (let index = 0; index < items.length; index++) {
			try {
				const resource = this.getNodeParameter('resource', index) as string;
				const operation = this.getNodeParameter('operation', index) as string;
				const parameters = getParameters(this, resource, operation, index) as IDataObject;
				const request = buildOperationRequest(
					resource,
					operation,
					parameters,
					this.getExecutionId(),
					index,
				);

				const response = await (postSiderApiRequest<unknown>).call(
					this,
					request.method,
					request.endpoint,
					request.input,
				);
				const simplify = Boolean(parameters.simplify ?? false);
				const output = prepareOutput(resource, operation, response, simplify);
				returnData.push(
					...this.helpers.constructExecutionMetaData(this.helpers.returnJsonArray(output), {
						itemData: { item: index },
					}),
				);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: index } });
					continue;
				}
				if ((error as { statusCode?: number }).statusCode !== undefined) {
					throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: index });
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: index });
			}
		}
		return [returnData];
	}
}
