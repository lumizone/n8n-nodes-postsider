import type { INodeProperties } from 'n8n-workflow';

const V2 = { '@version': [2] };
const SERVER_NOTE = 'Requires PostSider server 2026-11 or newer. ';

type OperationOption = { name: string; value: string; action: string; description: string };

const operation = (
	resource: string,
	options: OperationOption[],
	defaultValue: string,
): INodeProperties => ({
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { ...V2, resource: [resource] } },
	options,
	default: defaultValue,
});

const gated = (options: OperationOption[]): OperationOption[] =>
	options.map((option) => ({ ...option, description: SERVER_NOTE + option.description }));

const resourceProperty: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: V2 },
	options: [
		{ name: 'Approval', value: 'approval' },
		{ name: 'Channel', value: 'channel' },
		{ name: 'Group', value: 'group' },
		{ name: 'Media', value: 'media' },
		{ name: 'Policy', value: 'policy' },
		{ name: 'Post', value: 'post' },
		{ name: 'Publishing', value: 'publishing' },
	],
	default: 'post',
};

const operationProperties: INodeProperties[] = [
	operation(
		'approval',
		gated([
			{
				name: 'Approve',
				value: 'approve',
				action: 'Approve an approval request',
				description: 'Approve a pending approval. Needs an API key with the approvals:decide scope.',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many approvals',
				description: 'List approval requests, newest first',
			},
			{
				name: 'Get Status',
				value: 'getStatus',
				action: 'Get approval status',
				description: 'Retrieve the human approval state for a post',
			},
			{
				name: 'Reject',
				value: 'reject',
				action: 'Reject an approval request',
				description: 'Reject a pending approval. Needs an API key with the approvals:decide scope.',
			},
			{
				name: 'Request',
				value: 'request',
				action: 'Request approval for a post',
				description: 'Ask the approvers to review a post',
			},
		]),
		'getStatus',
	),
	operation(
		'channel',
		[
			{
				name: 'Disable',
				value: 'disable',
				action: 'Disable a channel',
				description: 'Stop publishing to a connected channel without disconnecting it',
			},
			{
				name: 'Enable',
				value: 'enable',
				action: 'Enable a channel',
				description: 'Resume publishing to a connected channel',
			},
			{
				name: 'Find Next Slot',
				value: 'findNextSlot',
				action: 'Find the next free queue slot for a channel',
				description: 'Find the next free queue slot for a channel',
			},
			{
				name: 'Get Analytics',
				value: 'getAnalytics',
				action: 'Get channel analytics',
				description: 'Retrieve analytics for a connected channel over a number of days',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many channels',
				description: 'Retrieve connected social channels',
			},
			{
				name: 'Get Rules',
				value: 'getRules',
				action: 'Get channel rules',
				description:
					'Retrieve the publishing rules of a channel: text length limit, whether media is required, and required settings',
			},
		],
		'getMany',
	),
	operation(
		'group',
		gated([
			{
				name: 'Archive',
				value: 'archive',
				action: 'Archive a group',
				description: 'Archive a group (customer workspace). Nothing is deleted.',
			},
			{
				name: 'Create',
				value: 'create',
				action: 'Create a group',
				description: 'Create a group (customer workspace)',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many groups',
				description: 'Retrieve channel groups',
			},
			{
				name: 'Rename',
				value: 'update',
				action: 'Rename a group',
				description: 'Change the name of a group',
			},
		]),
		'getMany',
	),
	operation(
		'media',
		[
			{
				name: 'Delete',
				value: 'delete',
				action: 'Delete media',
				description: 'Delete a file from the media library. This cannot be undone.',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many media files',
				description: 'List files in the media library',
			},
			{
				name: 'Upload',
				value: 'upload',
				action: 'Upload media',
				description: 'Upload a file from binary data or import a public URL into the media library',
			},
		],
		'upload',
	),
	operation(
		'policy',
		gated([
			{
				name: 'Check',
				value: 'check',
				action: 'Check a post against policies',
				description: 'Dry run: report which rules a post would hit, without creating it',
			},
			{
				name: 'Get Many Rules',
				value: 'getMany',
				action: 'Get many policy rules',
				description: 'List the publishing policy rules. Needs the policies:read scope.',
			},
		]),
		'check',
	),
	operation(
		'post',
		[
			{
				name: 'Check',
				value: 'check',
				action: 'Check a post before publishing',
				description: 'Validate post text against channel rules without creating the post',
			},
			{
				name: 'Delete',
				value: 'delete',
				action: 'Delete a post',
				description: 'Delete a post. This cannot be undone.',
			},
			{
				name: 'Duplicate',
				value: 'duplicate',
				action: 'Duplicate a post',
				description: 'Create a draft copy of an existing post',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a post',
				description: 'Retrieve a post and its channel versions',
			},
			{
				name: 'Get Analytics',
				value: 'getAnalytics',
				action: 'Get post analytics',
				description: 'Retrieve analytics for a published post',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many posts',
				description: 'Retrieve posts in a date range',
			},
			{
				name: 'Publish',
				value: 'publish',
				action: 'Publish a post',
				description:
					'Publish a post now, schedule it, put it in the next queue slot, or save it as a draft, on one or more channels',
			},
			{
				name: 'Retry Failed',
				value: 'retryFailed',
				action: 'Retry a failed post',
				description:
					SERVER_NOTE + 'Republish a post that failed, instead of creating a duplicate',
			},
			{
				name: 'Rewrite',
				value: 'rewrite',
				action: 'Rewrite a post for a channel',
				description: 'Rewrite post text to fit the rules and style of a channel',
			},
			{
				name: 'Update',
				value: 'update',
				action: 'Update a post',
				description: 'Change the text, time, or media of an existing post',
			},
		],
		'publish',
	),
	operation(
		'publishing',
		[
			{
				name: 'Get State',
				value: 'getState',
				action: 'Get publishing state',
				description: 'Check whether publishing is paused for the organization',
			},
			{
				name: 'Pause',
				value: 'pause',
				action: 'Pause publishing',
				description: 'Pause publishing for the whole organization. Queued posts wait until it is resumed.',
			},
		],
		'getState',
	),
];

const publishOnly = { ...V2, resource: ['post'], operation: ['publish'] };

const publishFields: INodeProperties[] = [
	{
		displayName: 'Channel Names or IDs',
		name: 'channels',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getChannels' },
		required: true,
		default: [],
		description:
			'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		displayOptions: { show: publishOnly },
	},
	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 5 },
		default: '',
		description: 'Text of the post, sent to every selected channel unless overridden per channel',
		displayOptions: { show: publishOnly },
	},
	{
		displayName: 'When',
		name: 'when',
		type: 'options',
		options: [
			{ name: 'Draft', value: 'draft', description: 'Save without publishing' },
			{ name: 'Next Free Slot', value: 'nextSlot', description: 'Place in the next free queue slot' },
			{ name: 'Now', value: 'now', description: 'Publish immediately' },
			{ name: 'Schedule', value: 'schedule', description: 'Publish at a given date and time' },
		],
		default: 'now',
		description: 'When the post should go out',
		displayOptions: { show: publishOnly },
	},
	{
		displayName: 'Date',
		name: 'date',
		type: 'dateTime',
		required: true,
		default: '',
		description: 'UTC date and time at which PostSider should publish the post',
		displayOptions: { show: { ...publishOnly, when: ['schedule'] } },
	},
	{
		displayName: 'Media',
		name: 'mediaSource',
		type: 'options',
		options: [
			{ name: 'Binary Data', value: 'binary', description: 'Upload files from the input item' },
			{ name: 'Already Uploaded', value: 'uploaded', description: 'Use media objects from Media > Upload' },
			{ name: 'None', value: 'none' },
			{ name: 'Public URLs', value: 'url', description: 'Import public HTTPS image or video URLs' },
		],
		default: 'none',
		description: 'Where the post media comes from',
		displayOptions: { show: publishOnly },
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryProperties',
		type: 'string',
		default: 'data',
		placeholder: 'e.g. data, data2',
		description: 'Comma-separated names of the binary properties that hold the files to upload',
		displayOptions: { show: { ...publishOnly, mediaSource: ['binary'] } },
	},
	{
		displayName: 'Media URLs',
		name: 'mediaUrls',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		placeholder: 'e.g. https://example.com/image.png',
		description: 'Public HTTPS image or video URLs, one per line or comma-separated',
		displayOptions: { show: { ...publishOnly, mediaSource: ['url'] } },
	},
	{
		displayName: 'Media JSON',
		name: 'mediaJson',
		type: 'json',
		default: '[]',
		description: 'Array of media objects returned by Media > Upload, each with ID and path',
		displayOptions: { show: { ...publishOnly, mediaSource: ['uploaded'] } },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: publishOnly },
		options: [
			{
				displayName: 'First Comment',
				name: 'firstComment',
				type: 'string',
				typeOptions: { rows: 2 },
				default: '',
				description: 'First comment to add under the post, on channels that support it',
			},
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				placeholder: 'e.g. campaign_2026_10_item_1',
				description:
					'Stable retry key. When empty, the node derives one from the execution and item.',
			},
			{
				displayName: 'Per-Channel Text',
				name: 'perChannelText',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				placeholder: 'Add Override',
				default: {},
				description: 'Use different text for some channels instead of the main text',
				options: [
					{
						name: 'override',
						displayName: 'Override',
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
								displayName: 'Text',
								name: 'text',
								type: 'string',
								typeOptions: { rows: 3 },
								default: '',
								description: 'Text for this channel',
							},
						],
					},
				],
			},
			{
				displayName: 'Settings JSON',
				name: 'settingsJson',
				type: 'json',
				default: '{}',
				description:
					'Provider settings object applied to every channel, for example who_can_reply_post for X',
			},
			{
				displayName: 'Shorten Links',
				name: 'shortLink',
				type: 'boolean',
				default: false,
				description: 'Whether PostSider should shorten links in the post',
			},
			{
				displayName: 'Tags',
				name: 'tags',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				placeholder: 'Add Tag',
				default: {},
				description: 'Tags to attach to the post',
				options: [
					{
						name: 'tag',
						displayName: 'Tag',
						values: [
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								description: 'Tag value',
							},
							{
								displayName: 'Label',
								name: 'label',
								type: 'string',
								default: '',
								description: 'Tag label shown in PostSider',
							},
						],
					},
				],
			},
			{
				displayName: 'Wait for Result',
				name: 'waitForResult',
				type: 'boolean',
				default: false,
				description:
					'Whether to wait until publishing finishes and return the final status and link. Only applies when publishing now.',
			},
			{
				displayName: 'Wait Timeout (Seconds)',
				name: 'waitTimeout',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 300 },
				default: 60,
				description: 'How long to wait for publishing to finish when Wait for Result is on',
			},
		],
	},
];

export const v2Properties: INodeProperties[] = [
	resourceProperty,
	...operationProperties,
	...publishFields,
];
