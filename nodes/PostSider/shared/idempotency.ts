import { createHash, randomUUID } from 'node:crypto';

import type { IExecuteFunctions } from 'n8n-workflow';

const SAFE_PART = /^[A-Za-z0-9._-]{1,64}$/;

function digest(value: string, length: number): string {
	return createHash('sha256').update(value).digest('hex').slice(0, length);
}

/** Keeps a short, safe value as it is and hashes anything long or with other characters. */
function safePart(value: string): string {
	return SAFE_PART.test(value) ? value : digest(value, 32);
}

/**
 * The part of a derived Idempotency-Key that identifies where the request comes from:
 * `<instance>:<workflow>:<execution>`. The backend remembers a key for 7 days per organization, so two
 * n8n instances, two workflows or a reset n8n database must not produce the same key.
 *
 * Instance and workflow are hashed (the instance ID is not meant to be shown). The same execution gives
 * the same value every time, so Retry On Fail repeats the same key. Without an execution ID a random
 * value is used, which is unique but not repeatable.
 */
export function executionScope(
	ctx: Pick<IExecuteFunctions, 'getExecutionId' | 'getWorkflow' | 'getInstanceId'>,
): string {
	const executionId = String(ctx.getExecutionId() ?? '').trim();
	const workflowId = String(ctx.getWorkflow().id ?? '');
	const instanceId = String(ctx.getInstanceId() ?? '');
	return [
		digest(instanceId, 12),
		digest(workflowId, 12),
		executionId ? safePart(executionId) : randomUUID(),
	].join(':');
}

/** Run index of the current node, 0 when it cannot be read. */
export function runIndexOf(ctx: Pick<IExecuteFunctions, 'getWorkflowDataProxy'>, index: number): number {
	try {
		const run = ctx.getWorkflowDataProxy(index).$runIndex;
		return typeof run === 'number' ? run : 0;
	} catch {
		return 0;
	}
}
