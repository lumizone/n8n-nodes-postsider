import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

export async function executeV2(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];
	for (let index = 0; index < items.length; index++) {
		try {
			const resource = this.getNodeParameter('resource', index) as string;
			const operation = this.getNodeParameter('operation', index) as string;
			throw new NodeOperationError(
				this.getNode(),
				`Unsupported PostSider operation: ${resource}.${operation}`,
				{ itemIndex: index },
			);
		} catch (error) {
			if (this.continueOnFail()) {
				returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: index } });
				continue;
			}
			throw new NodeOperationError(this.getNode(), (error as Error).message, { itemIndex: index });
		}
	}
	return [returnData];
}
