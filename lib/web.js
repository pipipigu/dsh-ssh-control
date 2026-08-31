import { n as defaultSshConfigFiles, t as appendSshHost } from "./config-yQefKyDE.js";
import { spawn } from "node:child_process";
//#region src/profiles/web.ts
const ROUTE_PREFIX = "/plugins/@dsh-external/dsh-ssh-control";
const REMOTE_SSH_STATE_PATH = `${ROUTE_PREFIX}/state`;
const REMOTE_SSH_PROBE_PATH = `${ROUTE_PREFIX}/probe`;
const REMOTE_SSH_CONFIG_HOST_PATH = `${ROUTE_PREFIX}/ssh-config/host`;
const REMOTE_SSH_SETTINGS_PATH = `${ROUTE_PREFIX}/settings`;
const name = "dsh-ssh-control-web";
const inject = ["remoteSshManager"];
/** Activate the Web surface only in compositions that provide a Web host. */
function apply(ctx) {
	ctx.inject(["webServer"], (child) => {
		child.effect(() => {
			const server = child.webServer;
			if (!server || typeof server.register !== "function") return () => {};
			const disposers = [];
			disposers.push(server.register({
				kind: "exact",
				path: REMOTE_SSH_STATE_PATH,
				handler: async (req, res) => {
					if (req.method !== "GET") {
						json(res, 405, { error: "Method not allowed" });
						return;
					}
					try {
						json(res, 200, await catalogState(child.remoteSshManager));
					} catch (err) {
						json(res, 500, { error: err?.message || String(err) });
					}
				}
			}));
			disposers.push(server.register({
				kind: "exact",
				path: REMOTE_SSH_SETTINGS_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") {
						json(res, 405, { error: "Method not allowed" });
						return;
					}
					try {
						const sshConfigFile = optionalString(await readJson(req), "sshConfigFile");
						await child.remoteSshManager.updateUserPreferences({ ...sshConfigFile === void 0 ? {} : { sshConfigFile } });
						json(res, 200, { sshConfigFile: child.remoteSshManager.snapshot().sshConfigFile });
					} catch (err) {
						json(res, 500, { error: err?.message || String(err) });
					}
				}
			}));
			disposers.push(server.register({
				kind: "exact",
				path: REMOTE_SSH_PROBE_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") {
						json(res, 405, { error: "Method not allowed" });
						return;
					}
					try {
						const serverId = requiredString(await readJson(req), "id");
						const target = (await child.remoteSshManager.listAvailableServers()).find((s) => s.id === serverId || s.label === serverId || s.sshTarget === serverId);
						if (!target) {
							json(res, 404, { error: `Unknown server ID '${serverId}'` });
							return;
						}
						json(res, 200, await probeServer(target.sshTarget));
					} catch (err) {
						json(res, 500, { error: err?.message || String(err) });
					}
				}
			}));
			disposers.push(server.register({
				kind: "exact",
				path: REMOTE_SSH_CONFIG_HOST_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") {
						json(res, 405, { error: "Method not allowed" });
						return;
					}
					try {
						const body = await readJson(req);
						const command = requiredString(body, "command");
						const configPath = requiredString(body, "configPath");
						await appendSshHost(configPath, command);
						await child.remoteSshManager.refresh();
						json(res, 200, { ok: true });
					} catch (err) {
						json(res, 500, { error: err?.message || String(err) });
					}
				}
			}));
			return () => {
				for (const dispose of disposers) dispose();
			};
		}, "dsh-ssh-control-web-routes");
	});
}
async function catalogState(manager) {
	const servers = await manager.listAvailableServers();
	const snapshot = manager.snapshot();
	return {
		servers: servers.map((s) => ({
			id: s.id,
			label: s.label,
			sshTarget: s.sshTarget,
			source: s.source,
			hostName: s.hostName,
			user: s.user,
			port: s.port,
			configPath: s.configPath
		})),
		discoveredServerCount: servers.length,
		workspaceCount: 0,
		workspaces: [],
		configFiles: defaultSshConfigFiles(),
		configErrors: [],
		customConfigFile: snapshot.sshConfigFile
	};
}
async function probeServer(sshTarget) {
	return new Promise((resolve) => {
		const child = spawn("ssh", [
			"-o",
			"BatchMode=yes",
			sshTarget,
			"hostname && uname -s"
		], { stdio: [
			"ignore",
			"pipe",
			"pipe"
		] });
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			resolve({
				reachable: false,
				error: "Connection timed out"
			});
		}, 1e4);
		child.stdout.on("data", (d) => stdout += d.toString());
		child.stderr.on("data", (d) => stderr += d.toString());
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code === 0) resolve({
				reachable: true,
				hostname: stdout.trim().split("\n")[0] || sshTarget,
				commands: {
					bash: true,
					uname: true
				}
			});
			else resolve({
				reachable: false,
				error: stderr.trim() || `ssh exit ${code}`
			});
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			resolve({
				reachable: false,
				error: err.message
			});
		});
	});
}
function json(res, status, body) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}
async function readJson(req) {
	const chunks = [];
	for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	const text = Buffer.concat(chunks).toString("utf8");
	return text ? JSON.parse(text) : {};
}
function requiredString(body, key) {
	const val = body[key];
	if (typeof val !== "string" || val.trim().length === 0) throw new Error(`Missing required field '${key}'`);
	return val.trim();
}
function optionalString(body, key) {
	const val = body[key];
	return typeof val === "string" && val.trim().length > 0 ? val.trim() : void 0;
}
//#endregion
export { REMOTE_SSH_CONFIG_HOST_PATH, REMOTE_SSH_PROBE_PATH, REMOTE_SSH_SETTINGS_PATH, REMOTE_SSH_STATE_PATH, ROUTE_PREFIX, apply, inject, name };
