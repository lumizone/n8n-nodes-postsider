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
		{ name: 'Policy', value: 'policy' },
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
		'policy',
		[
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
		],
		'check',
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
			operation: ['get', 'getStatus', 'request'],
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

const policyOnly = { resource: ['policy'], operation: ['check'] };
const groupNameOperations = { resource: ['group'], operation: ['create', 'update'] };

export const fieldProperties: INodeProperties[] = [
	postId,
	{
		displayName: 'Approval ID',
		name: 'approvalId',
		type: 'string',
		required: true,
		default: '',
		description: 'ID of the approval request, as returned by Approval > Get Many',
		displayOptions: { show: { resource: ['approval'], operation: ['approve', 'reject'] } },
	},
	{
		displayName: 'Note',
		name: 'note',
		type: 'string',
		typeOptions: { rows: 2 },
		default: '',
		description: 'Optional note stored with the decision (up to 500 characters)',
		displayOptions: { show: { resource: ['approval'], operation: ['approve', 'reject'] } },
	},
	{
		displayName: 'Status',
		name: 'approvalStatus',
		type: 'options',
		options: [
			{ name: 'Any', value: '' },
			{ name: 'Approved', value: 'APPROVED' },
			{ name: 'Pending', value: 'PENDING' },
			{ name: 'Rejected', value: 'REJECTED' },
		],
		default: 'PENDING',
		description: 'Only return approvals with this status',
		displayOptions: { show: { resource: ['approval'], operation: ['getMany'] } },
	},
	{
		displayName: 'Requested Since',
		name: 'since',
		type: 'dateTime',
		default: '',
		description: 'Only return approvals requested at or after this time',
		displayOptions: { show: { resource: ['approval'], operation: ['getMany'] } },
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: ['approval'], operation: ['getMany'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 100 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: {
			show: { resource: ['approval'], operation: ['getMany'], returnAll: [false] },
		},
	},
	{
		displayName: 'Group ID',
		name: 'targetGroupId',
		type: 'string',
		required: true,
		default: '',
		description: 'ID of the group, as returned by Group > Get Many',
		displayOptions: { show: { resource: ['group'], operation: ['update', 'archive'] } },
	},
	{
		displayName: 'Group Name',
		name: 'groupName',
		type: 'string',
		required: true,
		default: '',
		description: 'Name of the group (1 to 100 characters)',
		displayOptions: { show: groupNameOperations },
	},
	{
		displayName: 'Post Type',
		name: 'policyType',
		type: 'options',
		options: [
			{ name: 'Draft', value: 'draft' },
			{ name: 'Now', value: 'now' },
			{ name: 'Schedule', value: 'schedule' },
		],
		default: 'draft',
		description: 'How the post would be created. Nothing is created or published by this check.',
		displayOptions: { show: policyOnly },
	},
	{
		displayName: 'Publish Date',
		name: 'policyPublishDate',
		type: 'dateTime',
		required: true,
		default: '',
		description: 'UTC date and time the post would be scheduled for',
		displayOptions: { show: { ...policyOnly, policyType: ['schedule'] } },
	},
	{
		displayName: 'Channel Posts',
		name: 'policyChannelPosts',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Channel Post',
		required: true,
		default: {},
		description: 'The content to check, one entry for each target channel',
		displayOptions: { show: policyOnly },
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
						description: 'Caption or post content to check for this channel',
					},
					{
						displayName: 'First Comment',
						name: 'firstComment',
						type: 'string',
						typeOptions: { rows: 2 },
						default: '',
						description: 'Optional first comment to check',
					},
					{
						displayName: 'Media JSON',
						name: 'mediaJson',
						type: 'json',
						default: '[]',
						description: 'Array of media objects, each with ID and path',
					},
				],
			},
		],
	},
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
