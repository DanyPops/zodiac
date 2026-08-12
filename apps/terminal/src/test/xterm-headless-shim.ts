import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const headless = require("@xterm/headless") as { Terminal: new (options: Record<string, unknown>) => unknown };

export const Terminal = headless.Terminal;
