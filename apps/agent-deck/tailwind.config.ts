import type { Config } from "tailwindcss";

/**
 * Tailwind v4 does theme customization in CSS (@theme in src/styles.css),
 * not here. This file exists only to pin explicit content paths rather than
 * rely on v4's heuristic auto-detection, since this project mixes
 * root-level (index.html) and src-level files.
 */
export default {
	content: ["./index.html", "./playground.html", "./src/**/*.{ts,html}"],
} satisfies Config;
