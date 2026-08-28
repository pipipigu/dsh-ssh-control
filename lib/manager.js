import { n as defaultSshConfigFiles, r as discoverSshConfigHosts } from "./config-yQefKyDE.js";
import { Service } from "@deepseek-ai/cordis";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";
//#region src/routing/manager.ts
var RemoteSshManager = class extends Service {
	static inject = ["settings"];
	configScope;
	config;
	discoveredHosts = [];
	attachedSessions = /* @__PURE__ */ new Map();
	initialRefresh;
	constructor(ctx, initialConfig) {
		super(ctx, "remoteSshManager");
		this.config = {
			...initialConfig?.sshConfigFile !== void 0 ? { sshConfigFile: initialConfig.sshConfigFile } : {},
			...initialConfig?.servers !== void 0 ? { servers: initialConfig.servers } : { servers: [] },
			...initialConfig?.defaultServerId !== void 0 ? { defaultServerId: initialConfig.defaultServerId } : {}
		};
		if (ctx.settings !== void 0) {
			this.configScope = ctx.settings.register(settingsNamespace("ssh-control"), z.object({
				sshConfigFile: z.string(),
				servers: z.array(z.object({
					id: z.string(),
					label: z.string(),
					sshTarget: z.string()
				})),
				defaultServerId: z.string()
			}), { base: this.config });
			this.config = this.configScope.get();
			this.configScope.watch((next) => {
				this.config = next;
				this.refresh();
			});
		}
		this.initialRefresh = this.refresh();
	}
	async refresh() {
		const configFiles = this.config.sshConfigFile ? [this.config.sshConfigFile] : defaultSshConfigFiles();
		const discovered = [];
		try {
			const result = await discoverSshConfigHosts(configFiles);
			for (const host of result.hosts) discovered.push({
				id: host.id,
				label: host.label,
				sshTarget: host.sshTarget,
				hostName: host.hostName,
				user: host.user,
				port: host.port,
				source: "config",
				configPath: host.configPath
			});
		} catch {}
		for (const server of this.config.servers ?? []) discovered.push({
			id: server.id,
			label: server.label,
			sshTarget: server.sshTarget,
			source: "settings"
		});
		this.discoveredHosts = discovered;
	}
	async listAvailableServers() {
		await this.initialRefresh;
		return this.discoveredHosts;
	}
	sessionStatus(sessionId) {
		const attached = this.attachedSessions.get(sessionId);
		if (attached) return {
			sessionId,
			executionWorld: "remote",
			server: attached.server,
			status: `attached to ${attached.server.label} (${attached.server.sshTarget})`
		};
		return {
			sessionId,
			executionWorld: "local",
			status: "ready (local execution)"
		};
	}
	async attachSession(sessionId, opts) {
		await this.initialRefresh;
		const targetName = opts?.server?.trim() || this.config.defaultServerId;
		if (!targetName) throw new Error("attach: no server specified and no default server configured");
		const server = this.discoveredHosts.find((s) => s.id === targetName || s.label === targetName || s.sshTarget === targetName);
		if (!server) throw new Error(`attach: server '${targetName}' not found in SSH configurations`);
		this.attachedSessions.set(sessionId, { server });
		return {
			status: "attached",
			sessionId,
			serverId: server.id,
			serverLabel: server.label,
			sshTarget: server.sshTarget,
			message: `Session now defaulting to ${server.label} (${server.sshTarget})`
		};
	}
	async detachSession(sessionId) {
		this.attachedSessions.delete(sessionId);
		return {
			status: "detached",
			sessionId,
			message: "Switched back to local workspace execution."
		};
	}
	async updateUserPreferences(prefs) {
		if (this.configScope) {
			const next = {
				...this.config,
				...prefs
			};
			await this.configScope.replace(next);
			this.config = next;
			await this.refresh();
		}
	}
	snapshot() {
		return { ...this.config };
	}
};
function apply(ctx, config) {
	ctx.plugin(RemoteSshManager, config);
}
//#endregion
export { RemoteSshManager, apply, apply as default };
