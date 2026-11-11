import type { INodeProperties } from 'n8n-workflow';

import { fieldProperties as v1Fields } from '../resources/descriptions';

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
				name: 'Get Options',
				value: 'getOptions',
				action: "List options from a channel's platform",
				description:
					'List values such as Pinterest boards or Discord and Slack channels, to use in platform settings or Settings JSON',
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
				name: 'Change Status',
				value: 'changeStatus',
				action: 'Move a post between draft and queue',
				description:
					'Schedule queues a draft for its saved date, Draft takes a queued post out of the queue',
			},
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

/** Platform settings collection, shared by Publish and Update (nested inside each operation's Options). */
export const platformSettingsProperty: INodeProperties = {
	displayName: 'Platform Settings',
	name: 'platformSettings',
	type: 'collection',
	placeholder: 'Add Platform Setting',
	default: {},
	description:
		'Settings for specific platforms. Each field only applies to the platforms named in its description; safe defaults are added for the rest.',
	options: [
		{
			displayName: 'Instagram or Facebook Post Type',
			name: 'instagramPostType',
			type: 'options',
			options: [
				{ name: 'Post', value: 'post' },
				{ name: 'Story', value: 'story' },
			],
			default: 'post',
			description: 'Whether to publish as a post or a story. Applies to Instagram, Instagram Standalone and Facebook.',
		},
		{
			displayName: 'LinkedIn Image Carousel',
			name: 'linkedinCarousel',
			type: 'boolean',
			default: false,
			description: 'Whether to publish the images as a carousel. Applies to LinkedIn and LinkedIn Page.',
		},
		{
			displayName: 'Pinterest Board',
			name: 'pinterestBoard',
			type: 'string',
			default: '',
			description: 'ID of the board to pin to. Required by Pinterest. Use Channel > List Options to find board IDs.',
		},
		{
			displayName: 'Pinterest Link',
			name: 'link',
			type: 'string',
			default: '',
			description: 'Destination URL of the pin. Applies to Pinterest.',
		},
		{
			displayName: 'TikTok Allow Comments',
			name: 'tiktokAllowComments',
			type: 'boolean',
			default: true,
			description: 'Whether viewers can comment. Applies to TikTok.',
		},
		{
			displayName: 'TikTok Allow Duet',
			name: 'tiktokAllowDuet',
			type: 'boolean',
			default: false,
			description: 'Whether viewers can duet the video. Applies to TikTok.',
		},
		{
			displayName: 'TikTok Allow Stitch',
			name: 'tiktokAllowStitch',
			type: 'boolean',
			default: false,
			description: 'Whether viewers can stitch the video. Applies to TikTok.',
		},
		{
			displayName: 'TikTok Auto Add Music',
			name: 'tiktokAutoAddMusic',
			type: 'options',
			options: [
				{ name: 'No', value: 'no' },
				{ name: 'Yes', value: 'yes' },
			],
			default: 'no',
			description: 'Whether TikTok adds recommended music automatically. Applies to TikTok.',
		},
		{
			displayName: 'TikTok Privacy',
			name: 'tiktokPrivacy',
			type: 'options',
			options: [
				{ name: 'Followers of Creator', value: 'FOLLOWER_OF_CREATOR' },
				{ name: 'Mutual Follow Friends', value: 'MUTUAL_FOLLOW_FRIENDS' },
				{ name: 'Only Me', value: 'SELF_ONLY' },
				{ name: 'Public', value: 'PUBLIC_TO_EVERYONE' },
			],
			default: 'PUBLIC_TO_EVERYONE',
			description: 'Who can see the video. Applies to TikTok.',
		},
		{
			displayName: 'Title',
			name: 'title',
			type: 'string',
			default: '',
			description:
				'Title of the post or article. Applies to YouTube (default: first 100 characters of the text), TikTok, Pinterest, Dev.to, Medium, Hashnode, WordPress, Ghost and Blogger.',
		},
		{
			displayName: 'X Community URL',
			name: 'xCommunity',
			type: 'string',
			default: '',
			placeholder: 'https://x.com/i/communities/1493446837214187523',
			description: 'Post into this X community. Applies to X.',
		},
		{
			displayName: 'X Who Can Reply',
			name: 'xWhoCanReply',
			type: 'options',
			options: [
				{ name: 'Everyone', value: 'everyone' },
				{ name: 'Following', value: 'following' },
				{ name: 'Mentioned Users', value: 'mentionedUsers' },
				{ name: 'Subscribers', value: 'subscribers' },
				{ name: 'Verified', value: 'verified' },
			],
			default: 'everyone',
			description: 'Who is allowed to reply. Applies to X.',
		},
		{
			displayName: 'YouTube Made for Kids',
			name: 'youtubeMadeForKids',
			type: 'options',
			options: [
				{ name: 'No', value: 'no' },
				{ name: 'Yes', value: 'yes' },
			],
			default: 'no',
			description: 'Whether the video is made for kids. Applies to YouTube.',
		},
		{
			displayName: 'YouTube Visibility',
			name: 'youtubeVisibility',
			type: 'options',
			options: [
				{ name: 'Private', value: 'private' },
				{ name: 'Public', value: 'public' },
				{ name: 'Unlisted', value: 'unlisted' },
			],
			default: 'public',
			description: 'Who can watch the video. Applies to YouTube.',
		},
	],
};

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
			platformSettingsProperty,
			{
				displayName: 'Settings JSON',
				name: 'settingsJson',
				type: 'json',
				default: '{}',
				description:
					'Provider settings object applied to every channel (for example who_can_reply_post for X), or an object keyed by channel ID whose values are settings objects, applied per channel',
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
				displayName: 'Thread Parts',
				name: 'threadParts',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				placeholder: 'Add Thread Part',
				default: {},
				description:
					'Texts that post after the main text, in order: as a thread on X, Threads, Bluesky and Mastodon, and as follow-up comments on platforms that support them',
				options: [
					{
						name: 'part',
						displayName: 'Part',
						values: [
							{
								displayName: 'Text',
								name: 'text',
								type: 'string',
								typeOptions: { rows: 3 },
								required: true,
								default: '',
								description: 'Text of this part',
							},
							{
								displayName: 'Delay (Minutes)',
								name: 'delayMinutes',
								type: 'number',
								typeOptions: { minValue: 0, maxValue: 1440, numberPrecision: 0 },
								default: 0,
								description: 'Minutes to wait before posting this part. 0 posts it right after the previous one.',
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
					'Whether to wait until publishing finishes and return the final status and link. Only applies when publishing now or in the next free slot.',
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

const postOp = (...operations: string[]) => ({ ...V2, resource: ['post'], operation: operations });

const PLATFORM_OPTIONS = [
	['Bluesky', 'bluesky'],
	['Discord', 'discord'],
	['Facebook', 'facebook'],
	['Instagram', 'instagram'],
	['Instagram Standalone', 'instagram-standalone'],
	['LinkedIn', 'linkedin'],
	['LinkedIn Page', 'linkedin-page'],
	['Mastodon', 'mastodon'],
	['Pinterest', 'pinterest'],
	['Slack', 'slack'],
	['Telegram', 'telegram'],
	['Threads', 'threads'],
	['TikTok', 'tiktok'],
	['X', 'x'],
	['YouTube', 'youtube'],
].map(([name, value]) => ({ name, value }));

const postIdField = (description: string, operations: string[]): INodeProperties => ({
	displayName: 'Post ID',
	name: 'postId',
	type: 'string',
	required: true,
	default: '',
	description,
	displayOptions: { show: postOp(...operations) },
});

const simplifyField = (operations: string[]): INodeProperties => ({
	displayName: 'Simplify',
	name: 'simplify',
	type: 'boolean',
	default: true,
	description: 'Whether to return a short version of each post instead of the full response',
	displayOptions: { show: postOp(...operations) },
});

const updateOnly = postOp('update');

const postOperationFields: INodeProperties[] = [
	postIdField('ID of the post to retrieve', ['get']),
	simplifyField(['get', 'getMany']),
	postIdField('ID of the post to update', ['update']),
	postIdField(
		'ID of the post to delete. This deletes the whole post group, which means the post on every channel it was created for, and it cannot be undone.',
		['delete'],
	),
	postIdField('ID of the post to copy. The copy is saved as a draft.', ['duplicate']),
	postIdField('ID of the published post to read analytics for', ['getAnalytics']),
	postIdField('ID of the post to move between draft and queue', ['changeStatus']),
	{
		displayName: 'Status',
		name: 'status',
		type: 'options',
		options: [
			{ name: 'Draft', value: 'draft', description: 'Take a queued post out of the queue' },
			{ name: 'Schedule', value: 'schedule', description: 'Queue a draft for its saved date' },
		],
		default: 'schedule',
		description:
			'Schedule queues a draft for its saved date. Draft takes a queued post out of the queue. The response may include the policy result and whether approval was requested.',
		displayOptions: { show: postOp('changeStatus') },
	},
	{
		displayName: 'Group ID',
		name: 'postGroup',
		type: 'string',
		required: true,
		default: '',
		description:
			'Group ID of the post, as returned by Get or Get Many. All failed channels of the group are queued again.',
		displayOptions: { show: postOp('retryFailed') },
	},
	{
		displayName: 'Date Range',
		name: 'range',
		type: 'options',
		options: [
			{ name: 'Custom', value: 'custom', description: 'Choose a start and an end date' },
			{ name: 'Last 7 Days', value: 'last7', description: 'From 7 days ago until now' },
			{ name: 'Next 7 Days', value: 'next7', description: 'From now until 7 days ahead' },
		],
		default: 'next7',
		description: 'Which posts to return, by their publish date',
		displayOptions: { show: postOp('getMany') },
	},
	{
		displayName: 'Start Date',
		name: 'startDate',
		type: 'dateTime',
		required: true,
		default: '',
		description: 'Return posts from this UTC date and time',
		displayOptions: { show: { ...postOp('getMany'), range: ['custom'] } },
	},
	{
		displayName: 'End Date',
		name: 'endDate',
		type: 'dateTime',
		required: true,
		default: '',
		description: 'Return posts up to this UTC date and time',
		displayOptions: { show: { ...postOp('getMany'), range: ['custom'] } },
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: postOp('getMany') },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { ...postOp('getMany'), returnAll: [false] } },
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: postOp('getMany') },
		options: [
			{
				displayName: 'Channel Name or ID',
				name: 'channel',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getChannels' },
				default: '',
				description:
					'Only return posts of this channel. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Group Name or ID',
				name: 'groupId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getGroups' },
				default: '',
				description:
					'Only return posts of this channel group. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'State',
				name: 'state',
				type: 'options',
				options: [
					{ name: 'Any', value: 'any' },
					{ name: 'Draft', value: 'DRAFT' },
					{ name: 'Error', value: 'ERROR' },
					{ name: 'Published', value: 'PUBLISHED' },
					{ name: 'Queue', value: 'QUEUE' },
				],
				default: 'any',
				description: 'Only return posts in this state',
			},
		],
	},
	{
		displayName: 'Days',
		name: 'days',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 7,
		description: 'How many days of analytics to return',
		displayOptions: { show: postOp('getAnalytics') },
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		description: 'Only the fields you add are changed',
		displayOptions: { show: updateOnly },
		options: [
			{
				displayName: 'Date',
				name: 'date',
				type: 'dateTime',
				default: '',
				description: 'New UTC publish date and time',
			},
			{
				displayName: 'First Comment',
				name: 'firstComment',
				type: 'string',
				typeOptions: { rows: 2 },
				default: '',
				description: 'New first comment. Leave it empty to remove the first comment.',
			},
			platformSettingsProperty,
			{
				displayName: 'Settings JSON',
				name: 'settingsJson',
				type: 'json',
				default: '{}',
				description:
					'Extra platform settings as a JSON object. They are merged on top of the Platform Settings fields.',
			},
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				typeOptions: { rows: 5 },
				default: '',
				description: 'New text of the post',
			},
		],
	},
	{
		displayName: 'Media',
		name: 'updateMediaSource',
		type: 'options',
		options: [
			{ name: 'Binary Data', value: 'binary', description: 'Replace the media with files from the input item' },
			{ name: 'Keep Current Media', value: 'keep', description: 'Do not change the media' },
			{ name: 'Public URLs', value: 'url', description: 'Replace the media with public HTTPS image or video URLs' },
			{ name: 'Remove All Media', value: 'remove', description: 'Delete the media from the post' },
			{ name: 'Uploaded Media', value: 'uploaded', description: 'Replace the media with objects from Media > Upload' },
		],
		default: 'keep',
		description: 'Whether to replace the media of the post. New media replaces the old media.',
		displayOptions: { show: updateOnly },
	},
	{
		displayName: 'Input Binary Field',
		name: 'updateBinaryProperties',
		type: 'string',
		default: 'data',
		placeholder: 'e.g. data, data2',
		description: 'Comma-separated names of the binary properties that hold the files to upload',
		displayOptions: { show: { ...updateOnly, updateMediaSource: ['binary'] } },
	},
	{
		displayName: 'Media URLs',
		name: 'updateMediaUrls',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		placeholder: 'e.g. https://example.com/image.png',
		description: 'Public HTTPS image or video URLs, one per line or comma-separated',
		displayOptions: { show: { ...updateOnly, updateMediaSource: ['url'] } },
	},
	{
		displayName: 'Media JSON',
		name: 'updateMediaJson',
		type: 'json',
		default: '[]',
		description: 'Array of media objects returned by Media > Upload, each with ID and path',
		displayOptions: { show: { ...updateOnly, updateMediaSource: ['uploaded'] } },
	},
	{
		displayName: 'Options',
		name: 'duplicateOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: postOp('duplicate') },
		options: [
			{
				displayName: 'Channel Name or ID',
				name: 'channelId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getChannels' },
				default: '',
				description:
					'Put the copy on this channel instead of the original one. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Date',
				name: 'date',
				type: 'dateTime',
				default: '',
				description: 'UTC date and time to set on the copy',
			},
		],
	},
	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 5 },
		required: true,
		default: '',
		description: 'Text to check, up to 4000 characters',
		displayOptions: { show: postOp('check') },
	},
	{
		displayName: 'Platforms',
		name: 'platforms',
		type: 'multiOptions',
		required: true,
		options: PLATFORM_OPTIONS,
		default: [],
		description: 'Platforms to check the text against. Choose between 1 and 3.',
		displayOptions: { show: postOp('check') },
	},
	{
		displayName: 'Has Media',
		name: 'hasMedia',
		type: 'boolean',
		default: false,
		description: 'Whether the post will include an image or a video',
		displayOptions: { show: postOp('check') },
	},
	{
		displayName: 'Media Type',
		name: 'mediaType',
		type: 'options',
		options: [
			{ name: 'Image', value: 'image' },
			{ name: 'Mixed', value: 'mixed' },
			{ name: 'Video', value: 'video' },
		],
		default: 'image',
		description: 'Kind of media the post will include',
		displayOptions: { show: { ...postOp('check'), hasMedia: [true] } },
	},
	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 5 },
		required: true,
		default: '',
		description: 'Text to rewrite with AI, up to 4000 characters',
		displayOptions: { show: postOp('rewrite') },
	},
	{
		displayName: 'Options',
		name: 'rewriteOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: postOp('rewrite') },
		options: [
			{
				displayName: 'Number of Versions',
				name: 'count',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 5 },
				default: 1,
				description: 'How many rewritten versions to return, from 1 to 5',
			},
			{
				displayName: 'Platform',
				name: 'platform',
				type: 'options',
				options: PLATFORM_OPTIONS,
				default: 'x',
				description: 'Fit the rewrite to the rules and style of this platform',
			},
			{
				displayName: 'Tone',
				name: 'tone',
				type: 'options',
				options: [
					{ name: 'Casual', value: 'casual' },
					{ name: 'Formal', value: 'formal' },
					{ name: 'Punchy', value: 'punchy' },
					{ name: 'Rephrase', value: 'rephrase' },
					{ name: 'Shorten', value: 'shorten' },
				],
				default: 'rephrase',
				description: 'How the text should be rewritten',
			},
		],
	},
];

const show = (resource: string, ...operations: string[]) => ({ ...V2, resource: [resource], operation: operations });

/**
 * Approval, Group and Policy keep the version 1 fields with the same names, so both versions read them
 * with the same code. They are taken from the version 1 list and re-shown for version 2.
 */
const CONTROL_RESOURCES = ['approval', 'group', 'policy', 'channel'];
const controlFields: INodeProperties[] = v1Fields
	.filter((property) => {
		const resources = (property.displayOptions?.show?.resource ?? []) as string[];
		return resources.length > 0 && resources.every((resource) => CONTROL_RESOURCES.includes(resource));
	})
	.map((property) => ({
		...property,
		displayOptions: { ...property.displayOptions, show: { ...property.displayOptions?.show, ...V2 } },
	}));

const otherFields: INodeProperties[] = [
	{
		displayName: 'Post ID',
		name: 'postId',
		type: 'string',
		required: true,
		default: '',
		description: 'ID of the PostSider post',
		displayOptions: { show: show('approval', 'getStatus', 'request') },
	},
	{
		displayName: 'Source',
		name: 'uploadSource',
		type: 'options',
		options: [
			{ name: 'Binary Data', value: 'binary', description: 'Upload files from the input item' },
			{ name: 'Public URLs', value: 'url', description: 'Import public HTTPS image or video URLs' },
		],
		default: 'binary',
		description: 'Where the files come from',
		displayOptions: { show: show('media', 'upload') },
	},
	{
		displayName: 'Input Binary Field',
		name: 'uploadBinaryProperties',
		type: 'string',
		default: 'data',
		placeholder: 'e.g. data, data2',
		description: 'Comma-separated names of the binary properties that hold the files to upload',
		displayOptions: { show: { ...show('media', 'upload'), uploadSource: ['binary'] } },
	},
	{
		displayName: 'Media URLs',
		name: 'uploadUrls',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		placeholder: 'e.g. https://example.com/image.png',
		description: 'Public HTTPS image or video URLs, one per line or comma-separated',
		displayOptions: { show: { ...show('media', 'upload'), uploadSource: ['url'] } },
	},
	{
		displayName: 'Media ID',
		name: 'mediaId',
		type: 'string',
		required: true,
		default: '',
		description: 'ID of the file, as returned by Media > Upload or Media > Get Many',
		displayOptions: { show: show('media', 'delete') },
	},
	{
		displayName: 'Page',
		name: 'page',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 1,
		description: 'Page of the media library to return (18 files per page)',
		displayOptions: { show: show('media', 'getMany') },
	},
	{
		displayName: 'Search',
		name: 'search',
		type: 'string',
		default: '',
		description: 'Only return files whose name contains this text',
		displayOptions: { show: show('media', 'getMany') },
	},
	{
		displayName: 'Include Disabled',
		name: 'includeDisabled',
		type: 'boolean',
		default: false,
		description: 'Whether to also return channels that are disabled',
		displayOptions: { show: show('channel', 'getMany') },
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
		displayOptions: {
			show: show('channel', 'getRules', 'getOptions', 'findNextSlot', 'getAnalytics', 'enable', 'disable'),
		},
	},
	{
		displayName: 'Option List Name or ID',
		name: 'tool',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getChannelTools', loadOptionsDependsOn: ['channelId'] },
		default: '',
		required: true,
		description:
			'Which list to load from the platform. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: { show: show('channel', 'getOptions') },
	},
	{
		displayName: 'List Inputs',
		name: 'toolData',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Input',
		default: {},
		description: 'Inputs some lists need, such as a search word',
		displayOptions: { show: show('channel', 'getOptions') },
		options: [
			{
				name: 'field',
				displayName: 'Input',
				values: [
					{
						displayName: 'Key',
						name: 'key',
						type: 'string',
						default: '',
						description: 'Input name, for example word',
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
						description: 'Input value',
					},
				],
			},
		],
	},
	{
		displayName: 'Days',
		name: 'days',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 7,
		description: 'How many days of analytics to return',
		displayOptions: { show: show('channel', 'getAnalytics') },
	},
	{
		displayName: 'Reason',
		name: 'reason',
		type: 'string',
		default: '',
		description:
			'Why publishing is paused. Publishing can only be resumed in the PostSider dashboard, not from n8n.',
		displayOptions: { show: show('publishing', 'pause') },
	},
];

export const v2Properties: INodeProperties[] = [
	resourceProperty,
	...operationProperties,
	...publishFields,
	...postOperationFields,
	...controlFields,
	...otherFields,
];
