import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { continueOnFailJson, toNodeError } from '../shared/errors';
import { isCurrent } from '../shared/versions';

import { executeOtherOperation } from './otherOperations';
import { executePostOperation } from './postOperations';
import { executePublish, type IntegrationCache } from './publish';

/**
 * The operations of node version 2.1, which are the ones the PostSider API offers. Version 2 still runs
 * more (approval decisions, policies, group changes, as in 0.3.1), so a saved version 2 workflow keeps
 * working; in version 2.1 an expression can still reach a removed operation, and it is refused here instead
 * of sending a request that has no route.
 */
export const V2_OPERATIONS: Record<string, readonly string[]> = {
	approval: ['getStatus', 'request'],
	channel: [
		'disable',
		'enable',
		'findNextSlot',
		'getAnalytics',
		'getMany',
		'getOptions',
		'getRules',
	],
	group: ['getMany'],
	media: ['delete', 'getMany', 'upload'],
	post: [
		'changeStatus',
		'check',
		'delete',
		'duplicate',
		'get',
		'getAnalytics',
		'getMany',
		'publish',
		'retryFailed',
		'rewrite',
		'update',
	],
	publishing: ['getState', 'pause'],
};

const POST_OPERATIONS = new Set([
	'get',
	'getMany',
	'update',
	'delete',
	'duplicate',
	'retryFailed',
	'changeStatus',
	'check',
	'rewrite',
	'getAnalytics',
]);

export async function executeV2(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const current = isCurrent(this);
	const returnData: INodeExecutionData[] = [];
	// One GET /integrations per execution, shared by every item.
	const integrations: IntegrationCache = {};
	for (let index = 0; index < items.length; index++) {
		try {
			const resource = this.getNodeParameter('resource', index) as string;
			// A fallback keeps n8n's generic "Could not get parameter" away when the value was dropped.
			const operation = this.getNodeParameter('operation', index, '') as string;
			if (current && !V2_OPERATIONS[resource]?.includes(operation)) {
				throw new NodeOperationError(
					this.getNode(),
					`The operation '${resource} > ${operation || '(none)'}' is not available in this node version`,
					{ itemIndex: index },
				);
			}
			let output: IDataObject[];
			if (resource === 'post' && operation === 'publish') {
				output = await executePublish(this, index, integrations);
			} else if (resource === 'post' && POST_OPERATIONS.has(operation)) {
				output = await executePostOperation(this, index, operation);
			} else if (resource !== 'post') {
				output = await executeOtherOperation(this, index, resource, operation);
			} else {
				throw new NodeOperationError(
					this.getNode(),
					`Unsupported PostSider operation: ${resource}.${operation}`,
					{ itemIndex: index },
				);
			}
			returnData.push(
				...this.helpers.constructExecutionMetaData(this.helpers.returnJsonArray(output), {
					itemData: { item: index },
				}),
			);
		} catch (error) {
			if (this.continueOnFail()) {
				returnData.push({ json: continueOnFailJson(error), pairedItem: { item: index } });
				continue;
			}
			throw toNodeError(this.getNode(), error, index);
		}
	}
	return [returnData];
}
