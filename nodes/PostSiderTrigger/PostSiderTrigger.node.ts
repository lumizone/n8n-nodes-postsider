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

const EVENT_OPTIONS = [
	{ name: 'Post Failed', value: 'failed' },
	{ name: 'Post Published', value: 'published' },
	{ name: 'Post Scheduled', value: 'scheduled' },
];

export class PostSiderTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PostSider Trigger',
		name: 'postSiderTrigger',
		icon: { light: 'file:postsider.svg', dark: 'file:postsider.dark.svg' },
		group: ['trigger'],
		version: [1, 1.1],
		defaultVersion: 1.1,
		description:
			'Starts a workflow when PostSider posts are published, fail, or get scheduled. A new event is a post reaching a selected state that was not present in the previous poll (looking back 7 days and ahead 30 days), so a post that returns to a state it left is reported again.',
		eventTriggerDescription: 'Waiting for PostSider post events',
		subtitle: '={{$parameter["events"].join(", ")}}',
		defaults: { name: 'PostSider Trigger' },
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'postSiderApi', required: true }],
		properties: [
			// Version 1 exactly as published in 0.3.1: both fields on the top level.
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				options: EVENT_OPTIONS,
				default: ['published'],
				description: 'Which post events start the workflow',
				displayOptions: { show: { '@version': [1] } },
			},
			{
				displayName: 'Channel Names or IDs',
				name: 'channels',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getChannels' },
				default: [],
				description:
					'Only trigger for these channels. Leave empty for all channels. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: { show: { '@version': [1] } },
			},
			// Version 1.1: the channel filter moves into 'Options'.
			{
				displayName: 'Trigger On',
				name: 'events',
				type: 'multiOptions',
				required: true,
				options: EVENT_OPTIONS,
				default: ['published'],
				displayOptions: { show: { '@version': [{ _cnd: { gte: 1.1 } }] } },
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { '@version': [{ _cnd: { gte: 1.1 } }] } },
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
		// Version 1 keeps the channel filter on the top level; version 1.1 keeps it in 'Options'.
		const current = Number(this.getNode().typeVersion) >= 1.1;
		const channels = (
			current
				? ((this.getNodeParameter('options', {}) as IDataObject).channels ?? [])
				: this.getNodeParameter('channels', [])
		) as string[];
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
			const items = newestMatching(posts, events, channels, current);
			return items.length ? [this.helpers.returnJsonArray(items as IDataObject[])] : null;
		}

		const result = selectNewPosts(
			posts,
			events,
			channels,
			staticData.seen as string[] | undefined,
			current,
		);
		staticData.seen = result.seen;
		return result.emit.length ? [this.helpers.returnJsonArray(result.emit as IDataObject[])] : null;
	}
}
