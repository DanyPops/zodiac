import { connect } from "node:net";

const configuredPort = Number.parseInt(process.env.ZODIAC_DEV_PORT ?? "5173", 10);
const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65_535 ? configuredPort : 5173;
const hosts = ["127.0.0.1", "::1"];

function isListening(host) {
	return new Promise((resolve) => {
		const socket = connect({ host, port });
		const finish = (listening) => {
			socket.destroy();
			resolve(listening);
		};
		socket.setTimeout(500, () => finish(false));
		socket.once("connect", () => finish(true));
		socket.once("error", () => finish(false));
	});
}

const results = await Promise.all(hosts.map(async (host) => ({ host, listening: await isListening(host) })));
const occupied = results.filter(({ listening }) => listening);

if (occupied.length > 0) {
	console.error(`Zodiac dev port ${port} is already in use on ${occupied.map(({ host }) => host).join(", ")}.`);
	console.error(`Inspect every listener with: ss -ltnp '( sport = :${port} )'`);
	process.exit(1);
}
