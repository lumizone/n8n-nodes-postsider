/* eslint-disable @n8n/community-nodes/no-restricted-imports */
import assert from 'node:assert/strict';
import test from 'node:test';

import draftWorkflow from '../examples/import-media-and-create-draft.json';
import scheduleWorkflow from '../examples/find-slot-and-schedule.json';

test('example workflows remain inactive and use only draft or explicit schedule writes', () => {
	for (const workflow of [draftWorkflow, scheduleWorkflow]) {
		assert.equal(workflow.active, false);
		for (const node of workflow.nodes) {
			if (node.type !== 'n8n-nodes-postsider.postSider') continue;
			const type = 'type' in node.parameters ? node.parameters.type : undefined;
			assert.notEqual(type, 'now');
		}
	}
});

test('schedule example lets the node derive an execution-scoped idempotency key', () => {
	const scheduleNode = scheduleWorkflow.nodes.find((node) => node.id === 'schedule-post');
	assert.ok(scheduleNode);
	assert.equal('idempotencyKey' in scheduleNode.parameters, false);
});