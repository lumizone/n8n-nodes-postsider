/* eslint-disable @n8n/community-nodes/no-restricted-imports */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildChannelSettings } from '../nodes/PostSider/v2/platformSettings.ts';
import { v2Properties } from '../nodes/PostSider/v2/descriptions.ts';

test('x plain text gets everyone', () => {
	assert.deepEqual(buildChannelSettings('x', 'hello', {}, {}), { who_can_reply_post: 'everyone' });
});

test('x options map to backend keys', () => {
	const s = buildChannelSettings(
		'x',
		'hi',
		{ xWhoCanReply: 'following', xCommunity: 'https://x.com/i/communities/1' },
		{},
	);
	assert.equal(s.who_can_reply_post, 'following');
	assert.equal(s.community, 'https://x.com/i/communities/1');
});

test('youtube gets public and a 100 char title from text', () => {
	const s = buildChannelSettings('youtube', 'a'.repeat(250), {}, {});
	assert.equal(s.type, 'public');
	assert.equal(s.title, 'a'.repeat(100));
	const custom = buildChannelSettings(
		'youtube',
		'text',
		{ title: 'My video', youtubeVisibility: 'unlisted', youtubeMadeForKids: 'no' },
		{},
	);
	assert.equal(custom.title, 'My video');
	assert.equal(custom.type, 'unlisted');
	assert.equal(custom.selfDeclaredMadeForKids, 'no');
});

test('tiktok gets every required key', () => {
	assert.deepEqual(buildChannelSettings('tiktok', 'hi', {}, {}), {
		privacy_level: 'PUBLIC_TO_EVERYONE',
		duet: false,
		stitch: false,
		comment: true,
		autoAddMusic: 'no',
		brand_content_toggle: false,
		brand_organic_toggle: false,
		content_posting_method: 'DIRECT_POST',
	});
	const s = buildChannelSettings(
		'tiktok',
		'hi',
		{ tiktokPrivacy: 'SELF_ONLY', tiktokAllowDuet: true, tiktokAllowComments: false, title: 'T' },
		{},
	);
	assert.equal(s.privacy_level, 'SELF_ONLY');
	assert.equal(s.duet, true);
	assert.equal(s.comment, false);
	assert.equal(s.title, 'T');
});

test('instagram defaults to post and facebook only gets an explicit post type', () => {
	assert.deepEqual(buildChannelSettings('instagram', 'hi', {}, {}), { post_type: 'post' });
	assert.deepEqual(buildChannelSettings('instagram-standalone', 'hi', {}, {}), { post_type: 'post' });
	assert.deepEqual(buildChannelSettings('facebook', 'hi', {}, {}), {});
	assert.deepEqual(buildChannelSettings('facebook', 'hi', { instagramPostType: 'story' }, {}), {
		post_type: 'story',
	});
});

test('pinterest board is passed only to pinterest', () => {
	const opts = { pinterestBoard: 'b1', link: 'https://e.com' };
	assert.deepEqual(buildChannelSettings('pinterest', 'hi', opts, {}), { board: 'b1', link: 'https://e.com' });
	assert.equal('board' in buildChannelSettings('x', 'hi', opts, {}), false);
	assert.equal('link' in buildChannelSettings('x', 'hi', opts, {}), false);
});

test('linkedin carousel applies to linkedin and linkedin-page only', () => {
	assert.deepEqual(buildChannelSettings('linkedin-page', 'hi', { linkedinCarousel: true }, {}), {
		post_as_images_carousel: true,
	});
	assert.deepEqual(buildChannelSettings('x', 'hi', { linkedinCarousel: true }, {}), {
		who_can_reply_post: 'everyone',
	});
});

test('title applies to article providers only', () => {
	assert.deepEqual(buildChannelSettings('devto', 'hi', { title: 'T' }, {}), { title: 'T' });
	assert.equal('title' in buildChannelSettings('x', 'hi', { title: 'T' }, {}), false);
});

test('settings json overrides defaults', () => {
	const s = buildChannelSettings('x', 'hi', { xWhoCanReply: 'verified' }, { who_can_reply_post: 'following', made_with_ai: true });
	assert.equal(s.who_can_reply_post, 'following');
	assert.equal(s.made_with_ai, true);
});

test('unknown provider gets only extra', () => {
	assert.deepEqual(buildChannelSettings('mastodon', 'hi', { title: 'T', pinterestBoard: 'b' }, { a: 1 }), { a: 1 });
	assert.deepEqual(buildChannelSettings('mastodon', 'hi', {}, {}), {});
});

test('never sets __type', () => {
	for (const p of ['x', 'youtube', 'tiktok', 'instagram', 'pinterest']) {
		assert.equal('__type' in buildChannelSettings(p, 'hi', {}, {}), false);
	}
});

test('platformSettings collection lives inside publish options', () => {
	const options = v2Properties.find((p) => p.name === 'options' && p.displayOptions?.show?.operation?.includes('publish'));
	const ps = (options?.options as { name: string; type: string; options?: { name: string }[] }[]).find(
		(o) => o.name === 'platformSettings',
	);
	assert.equal(ps?.type, 'collection');
	const names = ps?.options?.map((o) => o.name);
	for (const n of ['xWhoCanReply', 'xCommunity', 'title', 'youtubeVisibility', 'youtubeMadeForKids', 'tiktokPrivacy', 'tiktokAllowComments', 'tiktokAllowDuet', 'tiktokAllowStitch', 'tiktokAutoAddMusic', 'instagramPostType', 'pinterestBoard', 'link', 'linkedinCarousel']) {
		assert.ok(names?.includes(n), n);
	}
});
