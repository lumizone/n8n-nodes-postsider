/* eslint-disable @n8n/community-nodes/no-restricted-imports */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildCreatePostBody,
	normalizeScheduledDate,
	parseJsonObject,
} from '../nodes/PostSider/shared/payloads.ts';

test('buildCreatePostBody creates a safe draft payload with API defaults', () => {
	assert.deepEqual(
		buildCreatePostBody({
			type: 'draft',
			date: '2026-10-01T10:00:00.000Z',
			shortLink: false,
			channels: [
				{
					channelId: 'channel_1',
					content: 'Hello from n8n',
				},
			],
		}),
		{
			type: 'draft',
			date: '2026-10-01T10:00:00.000Z',
			shortLink: false,
			tags: [],
			creationMethod: 'API',
			posts: [
				{
					integration: { id: 'channel_1' },
					value: [{ content: 'Hello from n8n', image: [] }],
					settings: {},
				},
			],
		},
	);
});

test('buildCreatePostBody preserves media, tags, first comment, and provider settings', () => {
	const media = [{ id: 'media_1', path: 'https://cdn.example/image.png' }];
	const settings = { post_type: 'post' };
	assert.deepEqual(
		buildCreatePostBody({
			type: 'schedule',
			date: '2026-10-02T12:00:00.000Z',
			shortLink: true,
			tags: [{ value: 'launch', label: 'Launch' }],
			channels: [
				{
					channelId: 'channel_ig',
					content: 'Scheduled',
					firstComment: 'First',
					media,
					settings,
				},
			],
		}),
		{
			type: 'schedule',
			date: '2026-10-02T12:00:00.000Z',
			shortLink: true,
			tags: [{ value: 'launch', label: 'Launch' }],
			creationMethod: 'API',
			posts: [
				{
					integration: { id: 'channel_ig' },
					value: [{ content: 'Scheduled', image: media }],
					firstComment: 'First',
					settings,
				},
			],
		},
	);
});

test('normalizeScheduledDate appends UTC designator to PostSider slot values', () => {
	assert.equal(normalizeScheduledDate('2026-10-02T09:00:00'), '2026-10-02T09:00:00.000Z');
	assert.equal(normalizeScheduledDate('2026-10-02T09:00:00Z'), '2026-10-02T09:00:00.000Z');
});

test('parseJsonObject accepts an object and rejects arrays', () => {
	assert.deepEqual(parseJsonObject('{"who_can_reply_post":"everyone"}', 'Settings'), {
		who_can_reply_post: 'everyone',
	});
	assert.throws(() => parseJsonObject('[]', 'Settings'), /Settings must be a JSON object/);
});
