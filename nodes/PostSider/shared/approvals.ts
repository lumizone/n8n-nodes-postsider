import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';

import {
	MAX_APPROVAL_PAGES,
	buildApprovalReadRequest,
	buildOperationRequest,
	extractList,
	nextCursor,
	readDecisionBinding,
} from './operations';
import { executionScope, runIndexOf } from './idempotency';
import { postSiderApiRequest } from './transport';

/**
 * Reads the parameters of the control-plane resources (approval, group, policy, channel group filter).
 * Version 1 declares all of them; version 2 only uses the approval post ID and the group list.
 */
export function readControlParameters(
	context: IExecuteFunctions,
	resource: string,
	operation: string,
	index: number,
): IDataObject | undefined {
	const get = (name: string, fallback?: unknown) => context.getNodeParameter(name, index, fallback);
	if (resource === 'channel') return { groupId: get('groupId', '') } as IDataObject;
	if (resource === 'group') {
		if (operation === 'create') return { groupName: get('groupName') } as IDataObject;
		const groupField = 'Group ID';
		if (operation === 'update') {
			return {
				targetGroupId: get('targetGroupId'),
				groupName: get('groupName'),
				groupField,
			} as IDataObject;
		}
		if (operation === 'archive') return { targetGroupId: get('targetGroupId'), groupField } as IDataObject;
		return {};
	}
	if (resource === 'policy') {
		if (operation !== 'check') return {};
		return {
			type: get('policyType', 'draft'),
			publishDate: get('policyPublishDate', ''),
			channelPosts: get('policyChannelPosts'),
		} as IDataObject;
	}
	if (resource === 'approval') {
		if (operation === 'getMany') {
			return {
				status: get('approvalStatus', ''),
				since: get('since', ''),
				returnAll: get('returnAll', false),
				limit: get('limit', 50),
			} as IDataObject;
		}
		if (operation === 'approve' || operation === 'reject') {
			return {
				approvalId: get('approvalId'),
				note: get('note', ''),
			} as IDataObject;
		}
		return { postId: get('postId') } as IDataObject;
	}
	return undefined;
}

/**
 * Builds and sends one control-plane request. Approve and Reject first read the approval to bind the
 * decision to the current stage and round (a failed read falls back to a random key); Approval Get Many
 * follows the cursor up to MAX_APPROVAL_PAGES pages when Return All is on.
 */
export async function runControlRequest(
	ctx: IExecuteFunctions,
	resource: string,
	operation: string,
	parameters: IDataObject,
	index: number,
): Promise<unknown> {
	if (resource === 'approval' && (operation === 'approve' || operation === 'reject')) {
		parameters.nodeName = ctx.getNode().name;
		// Validate before any network call; then bind the decision to the current stage and round.
		const read = buildApprovalReadRequest(ctx.getNode(), parameters);
		try {
			const current = await (postSiderApiRequest<unknown>).call(
				ctx,
				read.method,
				read.endpoint,
				read.input,
			);
			Object.assign(parameters, readDecisionBinding(current) ?? {});
		} catch {
			// no binding
		}
	}
	// Computed once: without an execution ID the scope is random and must not change between pages.
	const scope = executionScope(ctx);
	if (resource === 'post' && operation === 'create') parameters.runIndex = runIndexOf(ctx, index);
	const request = buildOperationRequest(ctx.getNode(), resource, operation, parameters, scope, index);
	if (resource === 'approval' && operation === 'getMany') {
		const approvals: unknown[] = [];
		let cursor: string | undefined;
		const pages = parameters.returnAll ? MAX_APPROVAL_PAGES : 1;
		for (let page = 0; page < pages; page++) {
			const pageRequest = cursor
				? buildOperationRequest(
						ctx.getNode(),
						resource,
						operation,
						{ ...parameters, cursor },
						scope,
						index,
					)
				: request;
			const pageResponse = await (postSiderApiRequest<unknown>).call(
				ctx,
				pageRequest.method,
				pageRequest.endpoint,
				pageRequest.input,
			);
			approvals.push(...extractList(pageResponse));
			cursor = nextCursor(pageResponse);
			if (!cursor) break;
		}
		return approvals;
	}
	return (postSiderApiRequest<unknown>).call(ctx, request.method, request.endpoint, request.input);
}
