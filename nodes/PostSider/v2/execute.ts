import type { IDataObject, IExecuteFunctions, INodeExecutionData, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { executePublish, type IntegrationCache } from './publish';

export async function executeV2(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];
	// One GET /integrations per execution, shared by every item.
	const integrations: IntegrationCache = {};
	for (let index = 0; index < items.length; index++) {
		try {
			const resource = this.getNodeParameter('resource', index) as string;
			const operation = this.getNodeParameter('operation', index) as string;
			let output: IDataObject[];
			if (resource === 'post' && operation === 'publish') {
				output = await executePublish(this, index, integrations);
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
			if ((error as { statusCode?: number }).statusCode !== undefined) {
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: index });
			}
			throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: index });
		}
	}
	return [returnData];
}
