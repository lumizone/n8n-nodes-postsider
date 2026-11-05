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

import approvalWorkflow from '../examples/approval-notify-slack.json';

test('approval example is inactive, uses only allowed node types and keeps decisions disabled', () => {
	assert.equal(approvalWorkflow.active, false);
	const allowed = new Set([
		'n8n-nodes-base.webhook',
		'n8n-nodes-base.code',
		'n8n-nodes-base.if',
		'n8n-nodes-base.stickyNote',
		'n8n-nodes-postsider.postSider',
	]);
	for (const node of approvalWorkflow.nodes) assert.ok(allowed.has(node.type), node.type);
	const decisions = approvalWorkflow.nodes.filter((node) => node.type === 'n8n-nodes-postsider.postSider');
	assert.equal(decisions.length, 2);
	for (const node of decisions) assert.equal((node as { disabled?: boolean }).disabled, true);
	const webhook = approvalWorkflow.nodes.find((node) => node.type === 'n8n-nodes-base.webhook');
	assert.equal(webhook?.parameters.httpMethod, 'POST');
	assert.equal((webhook?.parameters.options as { rawBody?: boolean }).rawBody, true);
});

test('approval example verifies the signature and the timestamp age', () => {
	const code = approvalWorkflow.nodes.find((node) => node.type === 'n8n-nodes-base.code');
	const source = String(code?.parameters.jsCode);
	assert.match(source, /x-postsider-signature/);
	assert.match(source, /createHmac\('sha256'/);
	assert.match(source, /timingSafeEqual/);
	assert.match(source, /5 \* 60 \* 1000/);
	assert.match(source, /\$env\.POSTSIDER_WEBHOOK_SECRET/);
});

test('approval example holds no secret-like strings', () => {
	const text = JSON.stringify(approvalWorkflow);
	assert.doesNotMatch(text, /hooks\.slack\.com/);
	assert.doesNotMatch(text, /sk_[A-Za-z0-9]{8,}|xox[a-z]-|Bearer\s+[A-Za-z0-9]/);
	assert.doesNotMatch(text, /"(apiKey|secret|token|password)"\s*:\s*"[^"]/i);
});
