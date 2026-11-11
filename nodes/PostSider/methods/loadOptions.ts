import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { postSiderApiRequest } from '../shared/transport';

interface Channel {
	id: string;
	name: string;
	identifier?: string;
	disabled?: boolean;
}

interface Group {
	id: string;
	name: string;
}

export async function getChannels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const channels = await (postSiderApiRequest<Channel[]>).call(this, 'GET', '/integrations');
	return channels
		.filter((channel) => !channel.disabled)
		.map((channel) => ({
			name: channel.identifier ? `${channel.name} (${channel.identifier})` : channel.name,
			value: channel.id,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getGroups(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const groups = await (postSiderApiRequest<Group[]>).call(this, 'GET', '/groups');
	return [
		{ name: 'All Groups', value: '' },
		...groups.map((group) => ({ name: group.name, value: group.id })).sort((a, b) =>
			a.name.localeCompare(b.name),
		),
	];
}

interface ChannelTool {
	methodName?: string;
	description?: string;
	dataSchema?: Array<{ key?: string }>;
}

export async function getChannelTools(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const channelId = String(this.getCurrentNodeParameter('channelId') ?? '').trim();
	if (!channelId) return [];
	const settings = await (postSiderApiRequest<{ output?: { tools?: ChannelTool[] | null } }>).call(
		this,
		'GET',
		`/integration-settings/${encodeURIComponent(channelId)}`,
	);
	const tools = settings?.output?.tools;
	if (!Array.isArray(tools)) return [];
	return tools
		.filter((tool) => tool && tool.methodName)
		.map((tool) => {
			const keys = (tool.dataSchema ?? []).map((field) => field.key).filter(Boolean);
			return {
				name: tool.description || String(tool.methodName),
				value: String(tool.methodName),
				...(keys.length > 0 ? { description: `Needs input: ${keys.join(', ')}` } : {}),
			};
		});
}
