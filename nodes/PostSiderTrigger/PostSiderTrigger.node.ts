import type {
	IDataObject,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
	INodeExecutionData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { getChannels } from '../PostSider/methods/loadOptions';
import { toNodeError } from '../PostSider/shared/errors';
import { postSiderApiRequest } from '../PostSider/shared/transport';
import { extractPosts, newestMatching, pollWindow, selectNewPosts } from './poll';

export class PostSiderTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PostSider Trigger',
		name: 'postSiderTrigger',
		icon: { light: 'file:postsider.svg', dark: 'file:postsider.dark.svg' },
		group: ['trigger'],
		version: 1,
		description:
			'Starts a workflow when PostSider posts are published, fail, or get scheduled. A new event is a post reaching a selected state that was not present in the previous poll (looking back 7 days), so a post that returns to a state it left is reported again.',
		eventTriggerDescription: 'Waiting for PostSider post events',
		subtitle: '={{$parameter["events"].join(", ")}}',
		defaults: { name: 'PostSider Trigger' },
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'postSiderApi', required: true }],
		properties: [
			{
				displayName: 'Trigger On',
				name: 'events',
				type: 'multiOptions',
				required: true,
				options: [
					{ name: 'Post Failed', value: 'failed' },
					{ name: 'Post Published', value: 'published' },
					{ name: 'Post Scheduled', value: 'scheduled' },
				],
				default: ['published'],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
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
			},
		],
	};

	methods = { loadOptions: { getChannels } };

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const events = this.getNodeParameter('events', []) as string[];
		const options = this.getNodeParameter('options', {}) as IDataObject;
		const channels = (options.channels ?? []) as string[];
		const staticData = this.getWorkflowStaticData('node') as IDataObject;
		const manual = this.getMode() === 'manual';
		const now = new Date();
		const window = pollWindow(now);

		let posts: unknown[];
		try {
			const response = await (postSiderApiRequest<IDataObject>).call(this, 'GET', '/posts', {
				qs: window,
			});
			posts = extractPosts(response);
		} catch (error) {
			throw toNodeError(this.getNode(), error);
		}

		if (manual) {
			const items = newestMatching(posts, events, channels);
			return items.length ? [this.helpers.returnJsonArray(items as IDataObject[])] : null;
		}

		const result = selectNewPosts(posts, events, channels, staticData.seen as string[] | undefined);
		staticData.seen = result.seen;
		return result.emit.length ? [this.helpers.returnJsonArray(result.emit as IDataObject[])] : null;
	}
}
