import type { INodeProperties } from 'n8n-workflow';

const operation = (
	resource: string,
	options: Array<{ name: string; value: string; action: string; description: string }>,
	defaultValue: string,
): INodeProperties => ({
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: [resource] } },
	options,
	default: defaultValue,
});

export const resourceProperty: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: [
		{ name: 'Approval', value: 'approval' },
		{ name: 'Channel', value: 'channel' },
		{ name: 'Group', value: 'group' },
		{ name: 'Media', value: 'media' },
		{ name: 'Post', value: 'post' },
		{ name: 'Scheduling', value: 'scheduling' },
	],
	default: 'post',
};

export const operationProperties: INodeProperties[] = [
	operation(
		'approval',
		[
			{
				name: 'Get Status',
				value: 'getStatus',
				action: 'Get approval status',
				description: 'Retrieve the human approval state for a post',
			},
		],
		'getStatus',
	),
	operation(
		'channel',
		[
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many channels',
				description: 'Retrieve connected social channels',
			},
		],
		'getMany',
	),
	operation(
		'group',
		[
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many groups',
				description: 'Retrieve channel groups',
			},
		],
		'getMany',
	),
	operation(
		'media',
		[
			{
				name: 'Import From URL',
				value: 'importFromUrl',
				action: 'Import media from URL',
				description: 'Import a public HTTPS image or video URL into the media library',
			},
		],
		'importFromUrl',
	),
	operation(
		'post',
		[
			{
				name: 'Create',
				value: 'create',
				action: 'Create a post',
				description: 'Create a draft or schedule a post',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a post',
				description: 'Retrieve a post and its channel versions',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many posts',
				description: 'Retrieve posts in a date range',
			},
		],
		'create',
	),
	operation(
		'scheduling',
		[
			{
				name: 'Find Next Slot',
				value: 'findNextSlot',
				action: 'Find next scheduling slot',
				description: 'Find the next free queue slot for a channel',
			},
		],
		'findNextSlot',
	),
];

const postId: INodeProperties = {
	displayName: 'Post ID',
	name: 'postId',
	type: 'string',
	required: true,
	default: '',
	description: 'ID of the PostSider post',
	displayOptions: {
		show: {
			resource: ['approval', 'post'],
			operation: ['get', 'getStatus'],
		},
	},
};

const groupFilter = (resource: 'channel' | 'post'): INodeProperties => ({
	displayName: 'Group Name or ID',
	name: 'groupId',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getGroups' },
	default: '',
	description:
		'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	displayOptions: { show: { resource: [resource], operation: ['getMany'] } },
});

export const fieldProperties: INodeProperties[] = [
	postId,
	groupFilter('channel'),
	groupFilter('post'),
	{
		displayName: 'Post Type',
		name: 'type',
		type: 'options',
		options: [
			{ name: 'Draft', value: 'draft' },
			{ name: 'Schedule', value: 'schedule' },
		],
		default: 'draft',
		description: 'Whether to save a draft or place the post in the publishing queue',
		displayOptions: { show: { resource: ['post'], operation: ['create'] } },
	},
	{
		displayName: 'Publish Date',
		name: 'publishDate',
		type: 'dateTime',
		required: true,
		default: '',
		description: 'UTC date and time at which PostSider should publish the post',
		displayOptions: {
			show: { resource: ['post'], operation: ['create'], type: ['schedule'] },
		},
	},
	{
		displayName: 'Channel Posts',
		name: 'channelPosts',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, sortable: true },
		placeholder: 'Add Channel Post',
		required: true,
		default: {},
		description: 'Add one native caption and settings object for each target channel',
		displayOptions: { show: { resource: ['post'], operation: ['create'] } },
		options: [
			{
				name: 'channelPost',
				displayName: 'Channel Post',
				values: [
					{
						displayName: 'Channel Name or ID',
						name: 'channelId',
						type: 'options',
						typeOptions: { loadOptionsMethod: 'getChannels' },
						default: '',
						required: true,
						description:
							'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
					},
					{
						displayName: 'Content',
						name: 'content',
						type: 'string',
						typeOptions: { rows: 5 },
						default: '',
						required: true,
						description: 'Native caption or post content for this channel',
					},
					{
						displayName: 'First Comment',
						name: 'firstComment',
						type: 'string',
						typeOptions: { rows: 2 },
						default: '',
						description: 'Optional first comment supported by selected providers',
					},
					{
						displayName: 'Media JSON',
						name: 'mediaJson',
						type: 'json',
						default: '[]',
						description: 'Array of media objects returned by Import Media From URL, each with ID and path',
					},
					{
						displayName: 'Settings JSON',
						name: 'settingsJson',
						type: 'json',
						default: '{}',
						description:
							'Provider settings object, for example who_can_reply_post for X or post_type for Instagram',
					},
				],
			},
		],
	},
	{
		displayName: 'Shorten Links',
		name: 'shortLink',
		type: 'boolean',
		default: false,
		description: 'Whether PostSider should shorten links in the post',
		displayOptions: { show: { resource: ['post'], operation: ['create'] } },
	},
	{
		displayName: 'Tags JSON',
		name: 'tagsJson',
		type: 'json',
		default: '[]',
		description: 'Optional array of objects containing value and label fields',
		displayOptions: { show: { resource: ['post'], operation: ['create'] } },
	},
	{
		displayName: 'Idempotency Key',
		name: 'idempotencyKey',
		type: 'string',
		default: '',
		placeholder: 'e.g. campaign_2026_10_item_1',
		description: 'Optional stable retry key. When empty, the node derives one from the execution and item.',
		displayOptions: { show: { resource: ['post'], operation: ['create'] } },
	},
	{
		displayName: 'Start Date',
		name: 'startDate',
		type: 'dateTime',
		required: true,
		default: '',
		description: 'Start of the date range',
		displayOptions: { show: { resource: ['post'], operation: ['getMany'] } },
	},
	{
		displayName: 'End Date',
		name: 'endDate',
		type: 'dateTime',
		required: true,
		default: '',
		description: 'End of the date range',
		displayOptions: { show: { resource: ['post'], operation: ['getMany'] } },
	},
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		description: 'Whether to return a simplified version of the response instead of the raw data',
		displayOptions: { show: { resource: ['post'], operation: ['get', 'getMany'] } },
	},
	{
		displayName: 'Channel Name or ID',
		name: 'channelId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getChannels' },
		default: '',
		required: true,
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		displayOptions: { show: { resource: ['scheduling'], operation: ['findNextSlot'] } },
	},
	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. https://example.com/image.png',
		description: 'Public HTTPS URL ending in a supported image or video file extension',
		displayOptions: { show: { resource: ['media'], operation: ['importFromUrl'] } },
	},
];
