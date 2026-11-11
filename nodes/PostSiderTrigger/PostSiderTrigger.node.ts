import type {
	IDataObject,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
	INodeExecutionData,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { getChannels } from '../PostSider/methods/loadOptions';
import { postSiderApiRequest } from '../PostSider/shared/transport';
import { extractPosts, newestMatching, pollWindow, selectNewPosts } from './poll';

export class PostSiderTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PostSider Trigger',
		name: 'postSiderTrigger',
		icon: { light: 'file:postsider.svg', dark: 'file:postsider.dark.svg' },
		group: ['trigger'],
		version: 1,
		description: 'Starts a workflow when PostSider posts are published, fail, or get scheduled',
		eventTriggerDescription: 'Waiting for PostSider post events',
		subtitle: '={{$parameter["events"].join(", ")}}',
		defaults: { name: 'PostSider Trigger' },
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'postSiderApi', required: true }],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				options: [
					{ name: 'Post Failed', value: 'failed' },
					{ name: 'Post Published', value: 'published' },
					{ name: 'Post Scheduled', value: 'scheduled' },
				],
				default: ['published'],
				description: 'Which post events start the workflow',
			},
			{
				displayName: 'Channel Names or IDs',
				name: 'channels',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getChannels' },
				default: [],
				description:
					'Only trigger for these channels. Leave empty for all channels. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
		],
	};

	methods = { loadOptions: { getChannels } };

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const events = this.getNodeParameter('events', []) as string[];
		const channels = this.getNodeParameter('channels', []) as string[];
		const staticData = this.getWorkflowStaticData('node') as IDataObject;
		const manual = this.getMode() === 'manual';
		const now = new Date();
		const window = pollWindow(now, manual ? undefined : (staticData.lastPoll as string | undefined));

		let posts: unknown[];
		try {
			const response = await (postSiderApiRequest<IDataObject>).call(this, 'GET', '/posts', {
				qs: window,
			});
			posts = extractPosts(response);
		} catch (error) {
			if ((error as { statusCode?: number }).statusCode !== undefined) {
				throw new NodeApiError(this.getNode(), error as JsonObject);
			}
			throw new NodeOperationError(this.getNode(), error as Error);
		}

		if (manual) {
			const items = newestMatching(posts, events, channels);
			return items.length ? [this.helpers.returnJsonArray(items as IDataObject[])] : null;
		}

		const result = selectNewPosts(posts, events, channels, staticData.seen as string[] | undefined);
		staticData.seen = result.seen;
		staticData.lastPoll = now.toISOString();
		return result.emit.length ? [this.helpers.returnJsonArray(result.emit as IDataObject[])] : null;
	}
}
