/**
 * The 12 zodiac sign glyphs, as React icon components -- same call shape as
 * a lucide-react icon (`size`/`className`/`aria-hidden`, see
 * `WorkspaceGlyphIconProps` in workspace/workspace-catalog.tsx), so they
 * drop into any call site that already expects one (UserAvatar.tsx today;
 * a future "pick your sign" WORKSPACE_GLYPH_OPTIONS-style catalog is the
 * reason every sign is exported individually and by id, not just "Libra").
 * The id/label/date-range catalog these icons belong to lives in
 * ./zodiac-sign-catalog.js instead of here, alongside every other
 * non-component export (ZODIAC_SIGNS, resolveZodiacSign) -- a file mixing
 * component and non-component exports breaks Fast Refresh (see
 * workspace/glyph-badge-style.ts's own doc comment for the same split, for
 * the same reason).
 *
 * The path data itself is not hand-drawn: every `<path>`/`<line>`/`<circle>`
 * below is transcribed verbatim (same coordinates, same viewBox) from the
 * real vendored artwork in ../assets/zodiac-signs/*.svg -- see that
 * directory's own README.md for the upstream source, exact version, and
 * SIL OFL 1.1 attribution this transcription itself is still bound by.
 * `stroke`/`fill`/`stroke-width` are hoisted onto the shared <svg> (every
 * source file uses the same three values throughout); every other
 * per-element attribute (`stroke-linecap`, `stroke-linejoin`,
 * `stroke-miterlimit`) is kept exactly as the source authored it rather
 * than normalized, so a miter-jointed corner in the original stays a
 * miter-jointed corner here.
 */
export interface ZodiacSignIconProps {
	readonly "aria-hidden"?: boolean | "true" | "false";
	readonly size?: number;
	readonly className?: string;
}

export function AriesIcon({ size = 24, className, ...rest }: ZodiacSignIconProps): React.JSX.Element {
	return (
		<svg viewBox="0 0 512 512" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth={32} {...rest}>
			<path d="M141.994,195.348C112.578,210.511,72.849,187.569,71.028,147.865C68.492,92.603,103.249,66.462,133.058,66.462C177.76,66.462,217.514,107.175,222.486,163.151L254.782,445.538" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M370.006,195.348C399.422,210.511,439.151,187.569,440.972,147.865  443.532,92.578,408.751,66.462,378.942,66.462  334.24,66.462,294.486,107.175,289.514,163.151L257.218,445.538" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

export function TaurusIcon({ size = 24, className, ...rest }: ZodiacSignIconProps): React.JSX.Element {
	return (
		<svg viewBox="0 0 512 512" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth={32} {...rest}>
			<circle cx="253.477" cy="304.025" r="141.514" strokeMiterlimit="10" />
			<path d="M417.735,66.683S360.677,61.44,334.732,103.409C313.785,137.28,284.32,162.511,255.052,162.511L256.923,162.511C227.655,162.511,198.191,137.28,177.243,103.409C151.323,61.415,94.265,66.683,94.265,66.683" strokeMiterlimit="10" strokeLinecap="round" />
		</svg>
	);
}

export function GeminiIcon({ size = 24, className, ...rest }: ZodiacSignIconProps): React.JSX.Element {
	return (
		<svg viewBox="0 0 512 512" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth={32} {...rest}>
			<line x1="188.517" y1="96.886" x2="188.517" y2="421.342" strokeLinecap="round" strokeMiterlimit="10" />
			<line x1="330.031" y1="96.886" x2="330.031" y2="421.342" strokeLinecap="round" strokeMiterlimit="10" />
			<path d="M102.585,66.462C127.175,76.012,181.108,93.932,254.215,94.326  330.228,94.745,386.252,76.012,410.892,66.462" strokeLinecap="round" strokeMiterlimit="10" />
			<path d="M101.083,445.538C125.674,435.988,179.606,418.068,252.714,417.674  328.726,417.255,384.751,435.988,409.391,445.538" strokeLinecap="round" strokeMiterlimit="10" />
		</svg>
	);
}

export function CancerIcon({ size = 24, className, ...rest }: ZodiacSignIconProps): React.JSX.Element {
	return (
		<svg viewBox="0 0 512 512" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth={32} {...rest}>
			<path d="M445.538,222.178C445.538,264.049,411.126,297.994,368.689,297.994S291.84,264.049,291.84,222.178  326.252,146.363,368.689,146.363C388.554,146.363,406.671,153.797,420.308,166.006  435.791,179.865,445.538,199.902,445.538,222.178Z" strokeLinecap="round" strokeMiterlimit="10" />
			<path d="M419.914,166.031S269.415,35.175,66.462,166.031" strokeLinecap="round" strokeMiterlimit="10" />
			<path d="M66.462,289.822C66.462,247.951,100.874,214.006,143.311,214.006  185.748,214.006,220.16,247.951,220.16,289.822S185.748,365.637,143.311,365.637C123.446,365.637,105.329,358.203,91.692,345.994  76.209,332.135,66.462,312.098,66.462,289.822Z" strokeLinecap="round" strokeMiterlimit="10" />
			<path d="M92.086,345.994S242.609,476.849,445.538,345.994" strokeLinecap="round" strokeMiterlimit="10" />
		</svg>
	);
}

export function LeoIcon({ size = 24, className, ...rest }: ZodiacSignIconProps): React.JSX.Element {
	return (
		<svg viewBox="0 0 512 512" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth={32} {...rest}>
			<path d="M236.893,283.663C236.893,317.979,210.024,345.79,176.873,345.79S116.853,317.979,116.853,283.663  143.721,221.537,176.873,221.537C192.395,221.537,206.532,227.635,217.194,237.632  229.298,248.996,236.893,265.406,236.893,283.645Z" strokeLinecap="round" strokeMiterlimit="10" />
			<path d="M350.132,350.465C370.145,350.465,395.147,369.591,395.147,397.697S360.129,460.674,320.88,447.129C295.434,438.351,270.118,415.308,270.118,387.201L270.063,386.961C270.063,317.018,319.716,289.909,369.572,239.276  426.746,181.197,384.67,61.859,273.075,61.859  214.773,61.859,165.083,92.165,165.083,152.758  165.083,198.216,214.607,227.746,226.101,248.22" strokeLinecap="round" strokeMiterlimit="10" />
		</svg>
	);
}

export function VirgoIcon({ size = 24, className, ...rest }: ZodiacSignIconProps): React.JSX.Element {
	return (
		<svg viewBox="0 0 512 512" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth={32} {...rest}>
			<path d="M166.64,383.808L166.64,133.699C163.531,93.812,140.667,64.564,116.488,63.667  87.616,62.603,63.646,99.799,63.646,150.868" strokeLinecap="round" strokeMiterlimit="10" />
			<path d="M269.967,383.808L269.967,133.699C266.858,93.812,243.994,64.564,219.816,63.667  190.943,62.603,166.973,99.799,166.973,150.868" strokeLinecap="round" strokeMiterlimit="10" />
			<path d="M373.44,383.808L373.273,133.699C370.165,93.812,347.301,64.564,323.122,63.667  294.25,62.603,270.28,99.799,270.28,150.868" strokeLinecap="round" strokeMiterlimit="10" />
			<path d="M373.44,383.808C373.44,404.273,387.647,448.354,448.354,448.354" strokeLinecap="round" strokeMiterlimit="10" />
			<path d="M373.294,204.17C373.294,160.715,393.446,144.422,408.613,144.422  413.661,144.422,419.273,145.027,424.509,147.843  444.578,158.65,444.098,190.401,443.931,204.17  443.138,272.116,446.873,372.543,317.406,421.422" strokeLinecap="round" strokeMiterlimit="10" />
		</svg>
	);
}

export function LibraIcon({ size = 24, className, ...rest }: ZodiacSignIconProps): React.JSX.Element {
	return (
		<svg viewBox="0 0 512 512" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth={32} {...rest}>
			<path d="M66.462,357.243L161.649,357.243S83.914,297.994,83.914,206.425S162.782,66.56,254.105,66.462" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M445.538,357.243L346.363,357.243S424.098,297.994,424.098,206.425S345.255,66.56,253.932,66.462" strokeLinecap="round" strokeLinejoin="round" />
			<line x1="66.462" y1="445.538" x2="445.538" y2="445.538" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

export function ScorpioIcon({ size = 24, className, ...rest }: ZodiacSignIconProps): React.JSX.Element {
	return (
		<svg viewBox="0 0 512 512" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth={32} {...rest}>
			<path d="M151.891,347.688L151.891,128.595C149.159,93.662,129.142,68.035,107.959,67.252  82.661,66.323,61.66,98.889,61.66,143.64" strokeMiterlimit="10" strokeLinecap="round" />
			<path d="M242.394,347.688L242.394,128.595C239.662,93.662,219.646,68.035,198.463,67.252  173.164,66.323,152.164,98.889,152.164,143.64" strokeMiterlimit="10" strokeLinecap="round" />
			<path d="M333.044,315.959L332.898,118.851C330.166,89.454,310.149,67.908,288.967,67.252  263.668,66.469,242.668,93.862,242.668,131.51" strokeMiterlimit="10" strokeLinecap="round" />
			<path d="M333.044,315.959C333.044,346.34,346.285,404.915,450.34,404.915L427.664,356.12" strokeLinecap="round" strokeLinejoin="round" />
			<line x1="407.319" y1="444.766" x2="450.34" y2="406.081" strokeMiterlimit="10" strokeLinecap="round" />
		</svg>
	);
}

export function SagittariusIcon({ size = 24, className, ...rest }: ZodiacSignIconProps): React.JSX.Element {
	return (
		<svg viewBox="0 0 512 512" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth={32} {...rest}>
			<line x1="444.333" y1="66.508" x2="66.508" y2="445.492" strokeLinecap="round" strokeLinejoin="round" />
			<line x1="445.492" y1="203.809" x2="445.492" y2="72.01" strokeLinecap="round" strokeLinejoin="round" />
			<line x1="314.064" y1="66.508" x2="445.492" y2="66.508" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M258.714,445.295S291.831,252.965,67.05,253.631" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

export function CapricornIcon({ size = 24, className, ...rest }: ZodiacSignIconProps): React.JSX.Element {
	return (
		<svg viewBox="0 0 512 512" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth={32} {...rest}>
			<path d="M104.492,344.369S170.437,202.732,324.111,221.588C443.938,236.308,444.357,336.295,444.357,336.295  444.357,336.295,444.357,445.538,295.483,445.538  140.898,445.538,163.791,308.972,192.418,265.28  221.046,221.588,464.615,91.422,444.332,76.234C395.298,39.557,160.295,121.772,66.462,68.628" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

export function AquariusIcon({ size = 24, className, ...rest }: ZodiacSignIconProps): React.JSX.Element {
	return (
		<svg viewBox="0 0 512 512" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth={32} {...rest}>
			<path d="M64.421,225.347S210.656,91.527,189.593,225.347" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M193.075,223.508S339.309,89.688,318.247,223.508" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M320.327,223.508S466.562,89.688,445.499,223.508" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M64.421,347.958S210.656,214.137,189.593,347.958" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M193.075,346.119S339.309,212.298,318.247,346.119" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M320.327,346.119S466.562,212.298,445.499,346.119" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

export function PiscesIcon({ size = 24, className, ...rest }: ZodiacSignIconProps): React.JSX.Element {
	return (
		<svg viewBox="0 0 512 512" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth={32} {...rest}>
			<line x1="109.428" y1="258.535" x2="402.572" y2="258.535" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M111.963,445.538C132.517,420.603,178.843,357.243,182.486,267.422C186.695,163.963,131.705,90.462,111.963,66.462" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M394.991,66.462C374.437,91.397,328.111,154.757,324.468,244.578  320.258,348.012,375.249,421.538,394.991,445.538" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}
