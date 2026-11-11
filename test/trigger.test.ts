/* eslint-disable @n8n/community-nodes/no-restricted-imports */
import assert from 'node:assert/strict';
import test from 'node:test';

import { pollWindow, selectNewPosts } from '../nodes/PostSiderTrigger/poll';

const post = (id: string, state: string, channel = 'c1', publishDate = '2026-11-10T10:00:00.000Z') => ({
	id,
	state,
	publishDate,
	integration: { id: channel, name: 'Ch', providerIdentifier: 'x' },
});

test('first run emits nothing and seeds', () => {
	const result = selectNewPosts([post('1', 'PUBLISHED')], ['published'], [], undefined);
	assert.deepEqual(result.emit, []);
	assert.deepEqual(result.seen, ['1:PUBLISHED']);
});

test('QUEUE then PUBLISHED emits once', () => {
	let seen = selectNewPosts([post('1', 'QUEUE')], ['published'], [], []).seen;
	let result = selectNewPosts([post('1', 'PUBLISHED')], ['published'], [], seen);
	assert.equal(result.emit.length, 1);
	assert.equal(result.emit[0].event, 'published');
	seen = result.seen;
	result = selectNewPosts([post('1', 'PUBLISHED')], ['published'], [], seen);
	assert.equal(result.emit.length, 0);
});

test('same PUBLISHED twice emits once', () => {
	const rows = [post('1', 'PUBLISHED'), post('1', 'PUBLISHED')];
	const result = selectNewPosts(rows, ['published'], [], []);
	assert.equal(result.emit.length, 1);
});

test('channel filter', () => {
	const rows = [post('1', 'PUBLISHED', 'c1'), post('2', 'PUBLISHED', 'c2')];
	const result = selectNewPosts(rows, ['published'], ['c2'], []);
	assert.deepEqual(result.emit.map((p) => p.id), ['2']);
});

test('failed and scheduled events map to ERROR and QUEUE', () => {
	const rows = [post('1', 'ERROR'), post('2', 'QUEUE'), post('3', 'DRAFT')];
	const result = selectNewPosts(rows, ['failed', 'scheduled'], [], []);
	assert.deepEqual(result.emit.map((p) => p.event), ['failed', 'scheduled']);
});

test('seen capped at 2000', () => {
	const rows = Array.from({ length: 2100 }, (_, i) => post(String(i), 'PUBLISHED'));
	const result = selectNewPosts(rows, ['published'], [], []);
	assert.equal(result.seen.length, 2000);
	assert.equal(result.seen[1999], '2099:PUBLISHED');
});

test('window never older than 7 days', () => {
	const now = new Date('2026-11-11T12:00:00.000Z');
	const old = pollWindow(now, '2026-10-01T00:00:00.000Z');
	assert.equal(old.startDate, '2026-11-04T12:00:00.000Z');
	assert.equal(old.endDate, '2026-12-11T12:00:00.000Z');
	const recent = pollWindow(now, '2026-11-11T11:00:00.000Z');
	assert.equal(recent.startDate, '2026-11-11T10:00:00.000Z');
	assert.equal(pollWindow(now).startDate, '2026-11-11T11:00:00.000Z');
});
