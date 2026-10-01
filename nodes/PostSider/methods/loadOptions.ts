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
