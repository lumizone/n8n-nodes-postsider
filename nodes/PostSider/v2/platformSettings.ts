/** Platform settings the node can build without the user typing JSON. Keys match the backend provider DTOs. */
export interface PlatformSettingsInput {
	xWhoCanReply?: 'everyone' | 'following' | 'mentionedUsers' | 'subscribers' | 'verified';
	xCommunity?: string;
	title?: string;
	youtubeVisibility?: 'public' | 'private' | 'unlisted';
	youtubeMadeForKids?: 'yes' | 'no';
	tiktokPrivacy?: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY';
	tiktokAllowComments?: boolean;
	tiktokAllowDuet?: boolean;
	tiktokAllowStitch?: boolean;
	tiktokAutoAddMusic?: 'yes' | 'no';
	instagramPostType?: 'post' | 'story';
	pinterestBoard?: string;
	link?: string;
	linkedinCarousel?: boolean;
}

const TITLE_PROVIDERS = new Set([
	'youtube',
	'tiktok',
	'pinterest',
	'devto',
	'medium',
	'hashnode',
	'wordpress',
	'ghost',
	'blogger',
]);
const INSTAGRAM_PROVIDERS = new Set(['instagram', 'instagram-standalone']);
const POST_TYPE_PROVIDERS = new Set(['instagram', 'instagram-standalone', 'facebook']);
const LINKEDIN_PROVIDERS = new Set(['linkedin', 'linkedin-page']);
const YOUTUBE_TITLE_MAX = 100;

function defaultsFor(provider: string, text: string): Record<string, unknown> {
	if (provider === 'x') return { who_can_reply_post: 'everyone' };
	if (provider === 'youtube') {
		return { type: 'public', title: text.slice(0, YOUTUBE_TITLE_MAX) };
	}
	if (provider === 'tiktok') {
		return {
			privacy_level: 'PUBLIC_TO_EVERYONE',
			duet: false,
			stitch: false,
			comment: true,
			autoAddMusic: 'no',
			brand_content_toggle: false,
			brand_organic_toggle: false,
			content_posting_method: 'DIRECT_POST',
		};
	}
	if (INSTAGRAM_PROVIDERS.has(provider)) return { post_type: 'post' };
	return {};
}

function set(target: Record<string, unknown>, key: string, value: unknown): void {
	if (value !== undefined && value !== '') target[key] = value;
}

/**
 * Settings for one channel: safe defaults first, then the user fields that apply to the provider,
 * then the Settings JSON object (`extra`) last so it always wins. `__type` is never set.
 */
export function buildChannelSettings(
	provider: string,
	text: string,
	options: PlatformSettingsInput,
	extra: Record<string, unknown>,
): Record<string, unknown> {
	const settings = defaultsFor(provider, text);

	if (provider === 'x') {
		set(settings, 'who_can_reply_post', options.xWhoCanReply);
		set(settings, 'community', options.xCommunity);
	}
	if (TITLE_PROVIDERS.has(provider)) set(settings, 'title', options.title);
	if (provider === 'youtube') {
		set(settings, 'type', options.youtubeVisibility);
		set(settings, 'selfDeclaredMadeForKids', options.youtubeMadeForKids);
	}
	if (provider === 'tiktok') {
		set(settings, 'privacy_level', options.tiktokPrivacy);
		set(settings, 'comment', options.tiktokAllowComments);
		set(settings, 'duet', options.tiktokAllowDuet);
		set(settings, 'stitch', options.tiktokAllowStitch);
		set(settings, 'autoAddMusic', options.tiktokAutoAddMusic);
	}
	if (POST_TYPE_PROVIDERS.has(provider)) set(settings, 'post_type', options.instagramPostType);
	if (provider === 'pinterest') {
		set(settings, 'board', options.pinterestBoard);
		set(settings, 'link', options.link);
	}
	if (LINKEDIN_PROVIDERS.has(provider)) {
		set(settings, 'post_as_images_carousel', options.linkedinCarousel);
	}

	return { ...settings, ...extra };
}
