import { resolveZodiacSign, type ZodiacSignId } from "./zodiac-sign-catalog.js";
import { cn } from "./cn.js";
import { GLYPH_SIZE_CLASSES, type GlyphSize } from "./glyph-size.js";

interface UserAvatarProps {
	/** No real per-user profile/sign picker exists yet -- every call site defaults this to DEFAULT_ZODIAC_SIGN_ID ("libra") via resolveZodiacSign's own fallback. Accepting an id (not a component) here for the same reason workspace-catalog.tsx persists a glyph *id*, not a component reference: this is meant to round-trip through Preferences once a real "pick your sign" flow exists. */
	readonly sign?: ZodiacSignId;
	readonly size?: GlyphSize;
	readonly className?: string;
}

/**
 * "User Avatar": the one circular identity mark in the shell, distinct from
 * every square Glyph Badge/Icon Button/Pillar Cap -- a person, not a
 * Workspace or an action. Sits in the top-left corner of the Workspace
 * pillar (both its expanded header's logo lockup and the collapsed
 * pillar's own top Pillar Cap), where a per-user profile picture would
 * eventually go; today it's this fixed accent-filled circle around a
 * zodiac sign glyph, "Libra" until a real profile/sign picker exists (see
 * DEFAULT_ZODIAC_SIGN_ID). Always `rounded-full`, never the shared
 * `--app-corner-radius` token every other shape in the shell follows --
 * an identity mark's own shape shouldn't drift with Corner Sharpness.
 */
export function UserAvatar({ sign, size = "md", className }: UserAvatarProps): React.JSX.Element {
	const resolved = resolveZodiacSign(sign ?? "libra");
	const Icon = resolved.icon;
	return (
		<span
			role="img"
			aria-label={`${resolved.label} (you)`}
			className={cn("grid shrink-0 place-items-center rounded-full bg-accent text-white", GLYPH_SIZE_CLASSES[size], className)}
		>
			<Icon aria-hidden="true" size={GLYPH_ICON_PIXELS[size]} />
		</span>
	);
}

/** Icon pixel size proportioned to sit comfortably inside each GLYPH_SIZE_CLASSES box (size-6 through size-9) with real padding around the circle's own curvature -- not the box's full side length, which would touch the circle's edge. */
const GLYPH_ICON_PIXELS: Record<GlyphSize, number> = {
	sm: 14,
	md: 16,
	xl: 18,
	lg: 20,
};
