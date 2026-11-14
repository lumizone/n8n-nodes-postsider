import type { IExecuteFunctions } from 'n8n-workflow';

/**
 * Node version 2.1 is the first with the current parameter layout and output. Version 2 is frozen to what
 * 0.3.1 published, so a saved workflow keeps its parameters and its output.
 */
export const CURRENT_NODE_VERSION = 2.1;

export function isCurrentNodeVersion(typeVersion: unknown): boolean {
	return Number(typeVersion) >= CURRENT_NODE_VERSION;
}

/** Whether the node being run is version 2.1 or later. */
export function isCurrent(ctx: Pick<IExecuteFunctions, 'getNode'>): boolean {
	return isCurrentNodeVersion(ctx.getNode().typeVersion);
}

/** Display name of the field that lists binary property names, as shown in the node version being run. */
export function binaryFieldLabel(current: boolean): string {
	return current ? 'Input Data Field Names' : 'Input Binary Field';
}

/** The time zone for date values without one: the workflow time zone from 2.1, UTC before. */
export function dateZone(ctx: Pick<IExecuteFunctions, 'getNode' | 'getTimezone'>): string | undefined {
	if (!isCurrent(ctx)) return undefined;
	try {
		return ctx.getTimezone();
	} catch {
		return undefined;
	}
}
