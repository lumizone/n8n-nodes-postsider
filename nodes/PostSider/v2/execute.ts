import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { toNodeError } from '../shared/errors';

import { executeOtherOperation } from './otherOperations';
import { executePostOperation } from './postOperations';
import { executePublish, type IntegrationCache } from './publish';

/**
 * The operations of node version 2, which are the ones the PostSider API offers. Version 1 still lists
 * more (approval decisions, policies, group changes), so a saved workflow or an expression can reach a
 * removed operation; it is refused here instead of sending a request that has no route.
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
	const returnData: INodeExecutionData[] = [];
	// One GET /integrations per execution, shared by every item.
	const integrations: IntegrationCache = {};
	for (let index = 0; index < items.length; index++) {
		try {
			const resource = this.getNodeParameter('resource', index) as string;
			const operation = this.getNodeParameter('operation', index) as string;
			if (!V2_OPERATIONS[resource]?.includes(operation)) {
				throw new NodeOperationError(
					this.getNode(),
					`The operation '${resource} > ${operation}' is not available in this node version`,
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
				returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: index } });
				continue;
			}
			throw toNodeError(this.getNode(), error, index);
		}
	}
	return [returnData];
}
