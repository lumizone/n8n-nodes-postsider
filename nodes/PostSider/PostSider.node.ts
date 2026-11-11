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
import { fieldProperties, operationProperties, resourceProperty } from './resources/descriptions';
import {
	MAX_APPROVAL_PAGES,
	buildOperationRequest,
	buildApprovalReadRequest,
	extractList,
	readDecisionBinding,
	nextCursor,
	normalizePostResponse,
	simplifyPostResponse,
} from './shared/operations';
import { postSiderApiRequest } from './shared/transport';
import { v2Properties } from './v2/descriptions';
import { executeV2 } from './v2/execute';

function getParameters(context: IExecuteFunctions, resource: string, operation: string, index: number) {
	const get = (name: string, fallback?: unknown) => context.getNodeParameter(name, index, fallback);
	if (resource === 'channel') return { groupId: get('groupId', '') };
	if (resource === 'group') {
		if (operation === 'create') return { groupName: get('groupName') };
		if (operation === 'update') {
			return { targetGroupId: get('targetGroupId'), groupName: get('groupName') };
		}
		if (operation === 'archive') return { targetGroupId: get('targetGroupId') };
		return {};
	}
	if (resource === 'policy') {
		if (operation !== 'check') return {};
		return {
			type: get('policyType', 'draft'),
			publishDate: get('policyPublishDate', ''),
			channelPosts: get('policyChannelPosts'),
		};
	}
	if (resource === 'media') return { url: get('url') };
	if (resource === 'scheduling') return { channelId: get('channelId') };
	if (resource === 'approval') {
		if (operation === 'getMany') {
			return {
				status: get('approvalStatus', ''),
				since: get('since', ''),
				returnAll: get('returnAll', false),
				limit: get('limit', 50),
			};
		}
		if (operation === 'approve' || operation === 'reject') {
			return { approvalId: get('approvalId'), note: get('note', '') };
		}
		return { postId: get('postId') };
	}
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
	if (resource === 'policy' && operation === 'getMany') {
		return extractList(normalized).map(asObject);
	}
	if (Array.isArray(normalized)) return normalized.map(asObject);
	return [asObject(normalized)];
}

export class PostSider implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PostSider',
		name: 'postSider',
		icon: { light: 'file:postsider.svg', dark: 'file:postsider.dark.svg' },
		group: ['output'],
		version: [1, 2],
		defaultVersion: 2,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Prepare, schedule, and review social media posts with PostSider',
		defaults: { name: 'PostSider' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'postSiderApi', required: true }],
		properties: [resourceProperty, ...operationProperties, ...fieldProperties, ...v2Properties],
	};

	methods = {
		loadOptions: {
			getChannels,
			getGroups,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		if (this.getNode().typeVersion >= 2) return executeV2.call(this);
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		for (let index = 0; index < items.length; index++) {
			try {
				const resource = this.getNodeParameter('resource', index) as string;
				const operation = this.getNodeParameter('operation', index) as string;
				const parameters = getParameters(this, resource, operation, index) as IDataObject;
				if (resource === 'approval' && (operation === 'approve' || operation === 'reject')) {
					parameters.nodeName = this.getNode().name;
					// Validate before any network call; then bind the decision to the
					// current stage and round. A failed read falls back to a random key.
					const read = buildApprovalReadRequest(this.getNode(), parameters);
					try {
						const current = await (postSiderApiRequest<unknown>).call(
							this,
							read.method,
							read.endpoint,
							read.input,
						);
						Object.assign(parameters, readDecisionBinding(current) ?? {});
					} catch {
						// no binding
					}
				}
				const request = buildOperationRequest(
					this.getNode(),
					resource,
					operation,
					parameters,
					this.getExecutionId(),
					index,
				);

				let response: unknown;
				if (resource === 'approval' && operation === 'getMany') {
					const approvals: unknown[] = [];
					let cursor: string | undefined;
					const pages = parameters.returnAll ? MAX_APPROVAL_PAGES : 1;
					for (let page = 0; page < pages; page++) {
						const pageRequest = cursor
							? buildOperationRequest(
									this.getNode(),
									resource,
									operation,
									{ ...parameters, cursor },
									this.getExecutionId(),
									index,
								)
							: request;
						const pageResponse = await (postSiderApiRequest<unknown>).call(
							this,
							pageRequest.method,
							pageRequest.endpoint,
							pageRequest.input,
						);
						approvals.push(...extractList(pageResponse));
						cursor = nextCursor(pageResponse);
						if (!cursor) break;
					}
					response = approvals;
				} else {
					response = await (postSiderApiRequest<unknown>).call(
						this,
						request.method,
						request.endpoint,
						request.input,
					);
				}
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
