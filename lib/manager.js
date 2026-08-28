import { RemoteDshHostConnection } from "./backend-connection.js";
import { n as RemoteDshWebProxy, t as DEFAULT_DSH_BACKEND_PORT } from "./web-BjetIhwf.js";
import { RemoteDshHostClient } from "./backend-client.js";
import { n as defaultSshConfigFiles, r as discoverSshConfigHosts } from "./config-CUgJ5skt.js";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, posix, relative, resolve, sep } from "node:path";
import { Context, Service } from "@deepseek-ai/cordis";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";
import { ActionType, AhpErrorCodes, SUPPORTED_PROTOCOL_VERSIONS } from "@microsoft/agent-host-protocol";
import { AhpClient, RpcError } from "@microsoft/agent-host-protocol/client";
import { FileSystem, FsError, FsTargetKey, FsVersion } from "@deepseek-ai/dsh-fs";
import { mkdirSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { WebSocketTransport } from "@microsoft/agent-host-protocol/ws";
import { ShellExecutor } from "@deepseek-ai/dsh-shell";
/** Single source of truth for every initialize handshake and diagnostic. */
const DSH_AHP_PROTOCOL_VERSIONS = Object.freeze([.../* @__PURE__ */ new Set([...["0.8.0"], ...SUPPORTED_PROTOCOL_VERSIONS])]);
/** Extract a negotiated-version rejection without coupling callers to RPC internals. */
function ahpProtocolMismatch(error, offeredVersions = DSH_AHP_PROTOCOL_VERSIONS) {
	if (!(error instanceof RpcError) || error.code !== AhpErrorCodes.UnsupportedProtocolVersion) return void 0;
	const data = typeof error.data === "object" && error.data !== null ? error.data : void 0;
	return {
		offeredVersions,
		serverVersions: Array.isArray(data?.supportedVersions) ? data.supportedVersions.filter((value) => typeof value === "string") : []
	};
}
function formatAhpProtocolMismatch(mismatch) {
	return `client offered [${mismatch.offeredVersions.join(", ") || "none"}], Agent Host accepts [${mismatch.serverVersions.join(", ") || "unknown"}]`;
}
//#endregion
//#region src/transport/runtime.ts
function quotePosix(value) {
	if (value.includes("\0")) throw new Error("remote command arguments cannot contain NUL bytes");
	return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
/** Build the POSIX bootstrap that resolves the VS Code CLI and starts Agent Host. */
function buildRemoteAgentHostCommand(remoteCodeCommand) {
	return [
		`dsh_code=${quotePosix(remoteCodeCommand)}`,
		"if [ \"$dsh_code\" = code ] && ! command -v \"$dsh_code\" >/dev/null 2>&1 && [ -x \"$HOME/.dsh-ssh-control/cli/bin/code\" ]; then dsh_code=\"$HOME/.dsh-ssh-control/cli/bin/code\"; fi",
		"if ! command -v \"$dsh_code\" >/dev/null 2>&1; then printf 'dsh-ssh-control: VS Code CLI not found: %s\\n' \"$dsh_code\" >&2; exit 127; fi",
		"exec \"$dsh_code\" agent host --host 127.0.0.1 --port 0 --idle-timeout 60 --server-data-dir \"$HOME/.dsh-ssh-control/server\" --cli-data-dir \"$HOME/.dsh-ssh-control/cli\" --verbose"
	].join("\n");
}
/** List installed VS Code Server entrypoints newest-first for compatibility probing. */
function buildListEmbeddedAgentHostsCommand() {
	return "find \"$HOME/.vscode-server/cli/servers\" -type f -path '*/server/bin/code-server' -perm -u+x -printf '%T@ %p\\n' 2>/dev/null | sort -nr | cut -d ' ' -f 2-";
}
/** Build the fallback bootstrap for a VS Code Server installation left by Remote - SSH. */
function buildEmbeddedAgentHostCommand(codeServerPath, instanceId = "default") {
	if (!/^[a-zA-Z0-9._-]+$/.test(instanceId)) throw new Error(`invalid embedded Agent Host instance id: ${instanceId}`);
	return [
		codeServerPath === void 0 ? `dsh_code_server=$(${buildListEmbeddedAgentHostsCommand()} | head -n 1)` : `dsh_code_server=${quotePosix(codeServerPath)}`,
		"if [ -z \"$dsh_code_server\" ]; then printf 'dsh-ssh-control: no usable code agent host or VS Code Server code-server found\\n' >&2; exit 127; fi",
		`exec "$dsh_code_server" --host 127.0.0.1 --port 0 --agent-host-port 0 --accept-server-license-terms --server-data-dir "$HOME/.dsh-ssh-control/server-embedded/${instanceId}" --log info`
	].join("\n");
}
function fileUriFromPosixPath(path) {
	if (!posix.isAbsolute(path)) throw new Error(`remote path must be absolute: ${path}`);
	return `file://${path.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
}
function posixPathFromFileUri(uri) {
	const parsed = new URL(uri);
	if (parsed.protocol !== "file:" || parsed.hostname !== "" && parsed.hostname !== "localhost") throw new Error(`expected a local file URI from Agent Host, received ${uri}`);
	const path = decodeURIComponent(parsed.pathname);
	if (!posix.isAbsolute(path)) throw new Error(`Agent Host returned a non-absolute file URI: ${uri}`);
	return posix.normalize(path);
}
var WorkspacePathMapper = class {
	localWorkspace;
	remoteWorkspace;
	constructor(localWorkspace, remoteWorkspace) {
		this.localWorkspace = resolve(localWorkspace);
		this.remoteWorkspace = posix.normalize(remoteWorkspace);
		if (!isAbsolute(this.localWorkspace)) throw new Error("localWorkspace must be an absolute local path");
		if (!posix.isAbsolute(this.remoteWorkspace)) throw new Error(`remoteWorkspace must be an absolute POSIX path: ${remoteWorkspace}`);
	}
	toRemotePath(input, cwd) {
		if (input.trim().length === 0) throw new Error("path must be a non-empty string");
		if (input.startsWith("file:")) return posixPathFromFileUri(input);
		if (isAbsolute(input)) {
			const rel = relative(this.localWorkspace, resolve(input));
			if (rel === "" || rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) return posix.resolve(this.remoteWorkspace, rel.split(sep).join("/"));
			if (input.startsWith("/")) return posix.normalize(input);
			throw new Error(`local path is outside the Remote SSH workspace alias: ${input}`);
		}
		if (input.startsWith("/")) return posix.normalize(input);
		const base = cwd === void 0 ? this.remoteWorkspace : this.toRemotePath(cwd);
		return posix.resolve(base, input.replaceAll("\\", "/"));
	}
};
var RemoteSshRuntime = class extends Service {
	static Config = z.object({
		sshTarget: z.string().required(),
		remoteWorkspace: z.string(),
		localWorkspace: z.string(),
		remoteAccessRoot: z.string(),
		sshExecutable: z.string().default("ssh"),
		sshArgs: z.array(z.string()).default([]),
		remoteCodeCommand: z.string().default("code"),
		remoteRuntimeRoot: z.string().default("/tmp/dsh-ssh-control"),
		startupTimeoutMs: z.number().default(6e5),
		requestTimeoutMs: z.number().default(3e4),
		protocolVersions: z.array(z.string()).default([...DSH_AHP_PROTOCOL_VERSIONS]),
		directUrl: z.string()
	});
	mapper;
	config;
	clientId = `dsh-ssh-control-${randomUUID()}`;
	runtimeRoot;
	remoteAccessRoot;
	ready;
	tunnel;
	embeddedAgentHost;
	disposed = false;
	constructor(ctx, config) {
		super(ctx, "remoteSsh");
		this.config = config;
		if (config.localWorkspace === void 0 !== (config.remoteWorkspace === void 0)) throw new Error("dsh-ssh-control: localWorkspace and remoteWorkspace must be configured together");
		this.mapper = config.localWorkspace === void 0 || config.remoteWorkspace === void 0 ? void 0 : new WorkspacePathMapper(config.localWorkspace, config.remoteWorkspace);
		this.remoteAccessRoot = posix.normalize(config.remoteAccessRoot ?? config.remoteWorkspace ?? "/");
		this.runtimeRoot = posix.join(this.config.remoteRuntimeRoot, this.clientId);
		this.validate();
		if (this.mapper !== void 0) mkdirSync(this.mapper.localWorkspace, { recursive: true });
		this.ready = this.open();
		this.ready.catch(() => {});
		ctx.effect(() => async () => {
			this.disposed = true;
			try {
				await (await this.ready).client.shutdown();
			} catch {} finally {
				this.tunnel?.kill();
				this.embeddedAgentHost?.kill();
			}
		}, "Remote SSH AHP teardown");
	}
	async getConnection() {
		if (this.disposed) throw new Error("Remote SSH service is disposing");
		const connection = await this.ready;
		if (this.disposed) throw new Error("Remote SSH service is disposing");
		return connection;
	}
	async getClient() {
		return (await this.getConnection()).client;
	}
	/** Workspace mapper for the legacy single-workspace providers. */
	getMapper() {
		if (this.mapper === void 0) throw new Error("dsh-ssh-control: this shared host runtime has no default workspace mapper");
		return this.mapper;
	}
	validate() {
		const { sshTarget, sshExecutable, remoteCodeCommand, remoteRuntimeRoot, startupTimeoutMs, requestTimeoutMs, protocolVersions } = this.config;
		if (sshTarget.trim().length === 0 && this.config.directUrl === void 0) throw new Error("dsh-ssh-control: sshTarget must be non-empty");
		if (sshExecutable.trim().length === 0) throw new Error("dsh-ssh-control: sshExecutable must be non-empty");
		if (remoteCodeCommand.trim().length === 0) throw new Error("dsh-ssh-control: remoteCodeCommand must be non-empty");
		if (!posix.isAbsolute(remoteRuntimeRoot)) throw new Error("dsh-ssh-control: remoteRuntimeRoot must be an absolute POSIX path");
		if (!posix.isAbsolute(this.remoteAccessRoot)) throw new Error("dsh-ssh-control: remoteAccessRoot must be an absolute POSIX path");
		if (!Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs <= 0) throw new Error("dsh-ssh-control: startupTimeoutMs must be a positive integer");
		if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) throw new Error("dsh-ssh-control: requestTimeoutMs must be a positive integer");
		if (protocolVersions.length === 0 || protocolVersions.some((version) => version.trim().length === 0)) throw new Error("dsh-ssh-control: protocolVersions must contain non-empty versions");
	}
	async open() {
		if (this.config.directUrl !== void 0) return this.connectEndpoint(this.config.directUrl);
		return this.openOverSsh();
	}
	async connectEndpoint(url) {
		const transport = await WebSocketTransport.connect(url);
		const client = new AhpClient(transport, { requestTimeoutMs: this.config.requestTimeoutMs });
		client.connect();
		try {
			const initialized = await client.initialize({
				clientId: this.clientId,
				protocolVersions: this.config.protocolVersions,
				initialSubscriptions: ["ahp-root://"]
			});
			const remoteUri = fileUriFromPosixPath(this.remoteAccessRoot);
			await client.resourceRequest({
				uri: remoteUri,
				read: true,
				write: true
			});
			const runtimeUri = fileUriFromPosixPath(this.runtimeRoot);
			await client.resourceRequest({
				uri: fileUriFromPosixPath(this.config.remoteRuntimeRoot),
				read: true,
				write: true
			});
			await client.resourceMkdir({ uri: runtimeUri });
			return {
				client,
				protocolVersion: initialized.protocolVersion,
				...initialized.defaultDirectory !== void 0 ? { defaultDirectory: initialized.defaultDirectory } : {}
			};
		} catch (error) {
			await client.shutdown().catch(() => {});
			throw error;
		}
	}
	async openOverSsh() {
		const diagnostics = [];
		const startupCommand = buildRemoteAgentHostCommand(this.config.remoteCodeCommand);
		let startup;
		try {
			startup = await runCaptured(this.config.sshExecutable, [
				...this.config.sshArgs,
				"-T",
				this.config.sshTarget,
				startupCommand
			], this.config.startupTimeoutMs);
		} catch (error) {
			if (this.config.remoteCodeCommand !== "code") throw error;
			diagnostics.push(`standalone CLI: ${errorMessage$2(error)}`);
			startup = {
				exitCode: null,
				stdout: "",
				stderr: ""
			};
		}
		const clean = stripAnsi(`${startup.stdout}\n${startup.stderr}`);
		const endpoint = /ws:\/\/(?:localhost|127\.0\.0\.1):(\d+)\?tkn=([^\s]+)/.exec(clean);
		if (endpoint?.[1] !== void 0 && endpoint[2] !== void 0) try {
			const url = await this.openTunnel(Number(endpoint[1]), endpoint[2]);
			return await this.connectEndpoint(url);
		} catch (error) {
			this.resetSshAttempt();
			diagnostics.push(`standalone CLI: ${connectionDiagnostic(error, this.config.protocolVersions)}`);
			if (this.config.remoteCodeCommand !== "code") throw new Error(`dsh-ssh-control: configured VS Code Agent Host failed\n${diagnostics.at(-1)}`, { cause: error });
		}
		else if (clean.trim().length > 0) diagnostics.push(`standalone CLI (ssh exit ${startup.exitCode ?? "unknown"}): ${tailDiagnostic(clean)}`);
		if (this.config.remoteCodeCommand !== "code") throw new Error(`dsh-ssh-control: remote VS Code Agent Host failed to start (ssh exit ${startup.exitCode})\n${clean}`);
		const candidates = await this.listEmbeddedAgentHosts();
		for (const [index, codeServerPath] of candidates.entries()) try {
			const url = await this.startEmbeddedAgentHost(codeServerPath, index);
			return await this.connectEndpoint(url);
		} catch (error) {
			this.resetSshAttempt();
			diagnostics.push(`embedded ${codeServerPath}: ${connectionDiagnostic(error, this.config.protocolVersions)}`);
		}
		if (candidates.length === 0) diagnostics.push("embedded VS Code Server: no installed code-server found");
		throw new Error(`dsh-ssh-control: no compatible VS Code Agent Host found\n${diagnostics.join("\n")}`);
	}
	async listEmbeddedAgentHosts() {
		const result = await runCaptured(this.config.sshExecutable, [
			...this.config.sshArgs,
			"-T",
			this.config.sshTarget,
			buildListEmbeddedAgentHostsCommand()
		], Math.min(this.config.startupTimeoutMs, 3e4));
		if (result.exitCode !== 0) return [];
		return [...new Set(result.stdout.split(/\r?\n/u).map((path) => path.trim()).filter(Boolean))];
	}
	async startEmbeddedAgentHost(codeServerPath, attempt) {
		const instanceId = `${this.clientId}-${attempt}`;
		const child = spawn(this.config.sshExecutable, [
			...this.config.sshArgs,
			"-T",
			this.config.sshTarget,
			buildEmbeddedAgentHostCommand(codeServerPath, instanceId)
		], {
			windowsHide: true,
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			]
		});
		this.embeddedAgentHost = child;
		let remotePort;
		try {
			remotePort = await waitForAgentHostPort(child, this.config.startupTimeoutMs);
		} catch (error) {
			child.kill();
			throw error;
		}
		const tokenResult = await runCaptured(this.config.sshExecutable, [
			...this.config.sshArgs,
			"-T",
			this.config.sshTarget,
			`cat "$HOME/.dsh-ssh-control/server-embedded/${instanceId}/data/token"`
		], Math.min(this.config.startupTimeoutMs, 3e4));
		const token = tokenResult.stdout.trim();
		if (tokenResult.exitCode !== 0 || token.length === 0 || /\s/.test(token)) {
			child.kill();
			throw new Error(`dsh-ssh-control: could not read the embedded Agent Host connection token\n${tokenResult.stderr}`);
		}
		return this.openTunnel(remotePort, token);
	}
	async openTunnel(remotePort, token) {
		const localPort = await reservePort();
		const tunnel = spawn(this.config.sshExecutable, [
			...this.config.sshArgs,
			"-T",
			"-N",
			"-o",
			"ExitOnForwardFailure=yes",
			"-o",
			"ServerAliveInterval=15",
			"-o",
			"ServerAliveCountMax=3",
			"-L",
			`127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
			this.config.sshTarget
		], {
			windowsHide: true,
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			]
		});
		this.tunnel = tunnel;
		await waitForPort(localPort, tunnel, 15e3);
		return `ws://127.0.0.1:${localPort}?tkn=${encodeURIComponent(token)}`;
	}
	resetSshAttempt() {
		this.tunnel?.kill();
		this.tunnel = void 0;
		this.embeddedAgentHost?.kill();
		this.embeddedAgentHost = void 0;
	}
};
async function runCaptured(command, args, timeoutMs) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, {
			windowsHide: true,
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			]
		});
		const stdout = [];
		const stderr = [];
		let size = 0;
		const append = (bucket, chunk) => {
			size += chunk.length;
			if (size > 4194304) {
				child.kill();
				reject(/* @__PURE__ */ new Error("dsh-ssh-control: SSH startup output exceeded 4 MiB"));
				return;
			}
			bucket.push(chunk);
		};
		child.stdout.on("data", (chunk) => {
			append(stdout, chunk);
		});
		child.stderr.on("data", (chunk) => {
			append(stderr, chunk);
		});
		child.once("error", reject);
		const timer = setTimeout(() => {
			child.kill();
			reject(/* @__PURE__ */ new Error(`dsh-ssh-control: SSH startup timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		child.once("close", (exitCode) => {
			clearTimeout(timer);
			resolvePromise({
				exitCode,
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8")
			});
		});
	});
}
async function waitForAgentHostPort(child, timeoutMs) {
	return new Promise((resolvePromise, reject) => {
		let output = "";
		let settled = false;
		const finish = (operation) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			operation();
		};
		const append = (chunk) => {
			output += chunk.toString("utf8");
			if (Buffer.byteLength(output, "utf8") > 4194304) {
				finish(() => reject(/* @__PURE__ */ new Error("embedded Agent Host startup output exceeded 4 MiB")));
				return;
			}
			const match = /Agent host server listening on (?:localhost|127\.0\.0\.1):(\d+)/.exec(stripAnsi(output));
			if (match?.[1] !== void 0) finish(() => resolvePromise(Number(match[1])));
		};
		child.stdout.on("data", append);
		child.stderr.on("data", append);
		child.once("error", (error) => {
			finish(() => reject(error));
		});
		child.once("close", (code) => {
			finish(() => reject(/* @__PURE__ */ new Error(`embedded Agent Host SSH process exited with code ${code}\n${stripAnsi(output)}`)));
		});
		const timer = setTimeout(() => {
			finish(() => reject(/* @__PURE__ */ new Error(`embedded Agent Host startup timed out after ${timeoutMs}ms\n${stripAnsi(output)}`)));
		}, timeoutMs);
	});
}
function stripAnsi(value) {
	return value.replace(/\x1B(?:[@-_][0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, "");
}
function errorMessage$2(error) {
	return error instanceof Error ? error.message : String(error);
}
function tailDiagnostic(value, maxLength = 2e3) {
	const clean = stripAnsi(value).trim();
	return clean.length <= maxLength ? clean : `…${clean.slice(-maxLength)}`;
}
function connectionDiagnostic(error, offeredVersions) {
	const mismatch = ahpProtocolMismatch(error, offeredVersions);
	return mismatch === void 0 ? tailDiagnostic(errorMessage$2(error)) : `AHP protocol mismatch: ${formatAhpProtocolMismatch(mismatch)}`;
}
async function reservePort() {
	const server = createServer();
	return new Promise((resolvePromise, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (address === null || typeof address === "string") {
				server.close();
				reject(/* @__PURE__ */ new Error("dsh-ssh-control: failed to reserve a TCP port"));
				return;
			}
			const port = address.port;
			server.close((error) => error === void 0 ? resolvePromise(port) : reject(error));
		});
	});
}
async function waitForPort(port, child, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error(`dsh-ssh-control: SSH tunnel exited with code ${child.exitCode}`);
		if (await new Promise((resolvePromise) => {
			const socket = createConnection({
				host: "127.0.0.1",
				port
			});
			socket.once("connect", () => {
				socket.destroy();
				resolvePromise(true);
			});
			socket.once("error", () => {
				socket.destroy();
				resolvePromise(false);
			});
		})) return;
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
	}
	child.kill();
	throw new Error(`dsh-ssh-control: SSH tunnel did not open port ${port} within ${timeoutMs}ms`);
}
//#endregion
//#region src/transport/fs.ts
const BASE64 = "base64";
const UTF8$1 = "utf-8";
var RemoteSshFileSystem = class extends FileSystem {
	static inject = ["remoteSsh"];
	static Config = z.object({
		diffBasisMaxBytes: z.number().default(10485760),
		maxReadBytes: z.number().default(67108864),
		localWorkspace: z.string(),
		remoteWorkspace: z.string()
	});
	config;
	remote;
	mapper;
	locks = /* @__PURE__ */ new Map();
	constructor(ctx, config) {
		super(ctx);
		this.remote = ctx.remoteSsh;
		this.config = config;
		if (config.localWorkspace === void 0 !== (config.remoteWorkspace === void 0)) throw new Error("dsh-ssh-control/fs: localWorkspace and remoteWorkspace must be configured together");
		this.mapper = config.localWorkspace !== void 0 && config.remoteWorkspace !== void 0 ? new WorkspacePathMapper(config.localWorkspace, config.remoteWorkspace) : requireRuntimeMapper(this.remote);
		for (const [name, value] of Object.entries({
			diffBasisMaxBytes: this.config.diffBasisMaxBytes,
			maxReadBytes: this.config.maxReadBytes
		})) if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`dsh-ssh-control/fs: ${name} must be a positive integer`);
	}
	async resolve(path, opts) {
		throwIfAborted(opts?.signal, "resolve");
		let candidate;
		try {
			candidate = this.mapper.toRemotePath(path, opts?.cwd);
		} catch (error) {
			throw new FsError(errorMessage$1(error), "FS_NOT_FOUND", { cause: error });
		}
		const missing = [];
		let cursor = candidate;
		for (;;) {
			throwIfAborted(opts?.signal, "resolve");
			try {
				const canonical = posixPathFromFileUri((await this.resolveUri(fileUriFromPosixPath(cursor), true)).uri);
				const remotePath = missing.reduceRight((base, part) => posix.join(base, part), canonical);
				return this.target(remotePath);
			} catch (error) {
				if (!isNotFound(error)) throw mapFsError("resolve", candidate, error);
				const parent = posix.dirname(cursor);
				if (parent === cursor) throw mapFsError("resolve", candidate, error);
				missing.push(posix.basename(cursor));
				cursor = parent;
			}
		}
	}
	processPath(target) {
		return posixPathFromFileUri(String(target.targetKey));
	}
	fileUrl(target) {
		return String(target.targetKey);
	}
	contains(parent, child) {
		const rel = posix.relative(this.processPath(parent), this.processPath(child));
		return rel === "" || rel !== ".." && !rel.startsWith("../") && !posix.isAbsolute(rel);
	}
	async stat(target, signal) {
		throwIfAborted(signal, "stat");
		const probe = await this.probe(target, true);
		throwIfAborted(signal, "stat");
		if (probe === void 0) return void 0;
		return {
			version: probe.version,
			type: resourceType(probe.resolved.type),
			...probe.resolved.size !== void 0 ? { size: probe.resolved.size } : {}
		};
	}
	async lstat(path, opts, signal) {
		throwIfAborted(signal, "lstat");
		let remotePath;
		try {
			remotePath = this.mapper.toRemotePath(path, opts?.cwd);
		} catch (error) {
			throw new FsError(errorMessage$1(error), "FS_NOT_FOUND", { cause: error });
		}
		try {
			const resolved = await this.resolveUri(fileUriFromPosixPath(remotePath), false);
			throwIfAborted(signal, "lstat");
			return {
				version: versionOf(resolved),
				type: resolved.type === "symlink" ? "symlink" : resourceType(resolved.type),
				...resolved.size !== void 0 ? { size: resolved.size } : {}
			};
		} catch (error) {
			if (isNotFound(error)) return void 0;
			throw mapFsError("lstat", remotePath, error);
		}
	}
	async readText(target, signal) {
		return decodeText(await this.readBytes(target, signal, this.config.maxReadBytes), target.displayPath);
	}
	async streamText(target, signal) {
		const text = await this.readText(target, signal);
		return (async function* () {
			let offset = 0;
			while (offset < text.length) {
				throwIfAborted(signal, "read");
				let end = Math.min(text.length, offset + 65536);
				if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1] ?? "")) end -= 1;
				yield text.slice(offset, end);
				offset = end;
			}
		})();
	}
	async readBytes(target, signal, maxBytes) {
		if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new FsError("maxBytes must be a non-negative integer", "FS_TOO_LARGE");
		throwIfAborted(signal, "read");
		const info = await this.stat(target, signal);
		if (info === void 0) throw new FsError(`cannot read "${target.displayPath}": file not found`, "FS_NOT_FOUND");
		if (info.type !== "file") throw new FsError(`cannot read "${target.displayPath}": not a regular file`, "FS_NOT_REGULAR_FILE");
		if (info.size !== void 0 && info.size > maxBytes) throw new FsError(`cannot read "${target.displayPath}": file exceeds ${maxBytes} bytes`, "FS_TOO_LARGE");
		try {
			const result = await (await this.remote.getClient()).resourceRead({
				uri: this.fileUrl(target),
				encoding: BASE64
			});
			throwIfAborted(signal, "read");
			const bytes = result.encoding === BASE64 ? Buffer.from(result.data, "base64") : Buffer.from(result.data, "utf8");
			if (bytes.length > maxBytes) throw new FsError(`cannot read "${target.displayPath}": file exceeds ${maxBytes} bytes`, "FS_TOO_LARGE");
			return bytes;
		} catch (error) {
			if (error instanceof FsError) throw error;
			throw mapFsError("read", target.displayPath, error);
		}
	}
	async listDir(target, signal) {
		throwIfAborted(signal, "list");
		try {
			const listed = await (await this.remote.getClient()).resourceList({ uri: this.fileUrl(target) });
			const entries = [];
			for (const entry of listed.entries.sort((a, b) => a.name.localeCompare(b.name))) {
				throwIfAborted(signal, "list");
				const child = await this.resolve(posix.join(this.processPath(target), entry.name), signal === void 0 ? void 0 : { signal });
				const info = await this.stat(child, signal);
				entries.push({
					name: entry.name,
					type: info?.type ?? entry.type,
					target: child,
					...info?.version !== void 0 ? { version: info.version } : {},
					...info?.size !== void 0 ? { size: info.size } : {}
				});
			}
			return entries;
		} catch (error) {
			if (error instanceof FsError) throw error;
			throw mapFsError("list", target.displayPath, error);
		}
	}
	async writeText(target, content, expected, signal, sandboxPolicy) {
		assertMutationAllowed(this.mapper, target, sandboxPolicy);
		return this.withLock(String(target.targetKey), async () => {
			throwIfAborted(signal, "write");
			const existing = await this.probe(target, true);
			if (existing !== void 0 && resourceType(existing.resolved.type) !== "file") throw new FsError(`cannot write "${target.displayPath}": not a regular file`, "FS_NOT_REGULAR_FILE");
			if (expected?.kind === "replaceIfVersion") {
				if (existing === void 0 || existing.version !== expected.version) throw new FsError(`cannot write "${target.displayPath}": file changed since it was read`, "FS_STALE_VERSION");
			} else if (expected?.kind === "createIfAbsent" && existing !== void 0) throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, "FS_NOT_OBSERVED");
			let before = null;
			if (existing !== void 0 && (existing.resolved.size ?? this.config.diffBasisMaxBytes) < this.config.diffBasisMaxBytes && Buffer.byteLength(content, "utf8") < this.config.diffBasisMaxBytes) try {
				before = normalizeLineEndings(await this.readText(target, signal));
			} catch {
				before = null;
			}
			try {
				await (await this.remote.getClient()).resourceWrite({
					uri: this.fileUrl(target),
					data: content,
					encoding: UTF8$1,
					contentType: "text/plain; charset=utf-8",
					...expected?.kind === "createIfAbsent" ? { createOnly: true } : {},
					...expected?.kind === "replaceIfVersion" && existing?.resolved.etag !== void 0 ? { ifMatch: existing.resolved.etag } : {}
				});
			} catch (error) {
				if (error instanceof RpcError && error.code === AhpErrorCodes.AlreadyExists) throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, "FS_NOT_OBSERVED", { cause: error });
				throw mapFsError("write", target.displayPath, error);
			}
			throwIfAborted(signal, "write");
			const after = await this.probe(target, true);
			if (after === void 0) throw new FsError(`write did not publish "${target.displayPath}"`, "FS_IO_ERROR");
			return {
				operation: existing === void 0 ? "create" : "update",
				version: after.version,
				before,
				after: normalizeLineEndings(content)
			};
		});
	}
	async writeBytes(target, content, expected, signal, sandboxPolicy) {
		assertMutationAllowed(this.mapper, target, sandboxPolicy);
		return this.withLock(String(target.targetKey), async () => {
			throwIfAborted(signal, "write");
			const existing = await this.probe(target, true);
			if (existing !== void 0 && resourceType(existing.resolved.type) !== "file") throw new FsError(`cannot write "${target.displayPath}": not a regular file`, "FS_NOT_REGULAR_FILE");
			if (expected?.kind === "replaceIfVersion") {
				if (existing === void 0 || existing.version !== expected.version) throw new FsError(`cannot write "${target.displayPath}": file changed since it was read`, "FS_STALE_VERSION");
			} else if (expected?.kind === "createIfAbsent" && existing !== void 0) throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, "FS_NOT_OBSERVED");
			try {
				await (await this.remote.getClient()).resourceWrite({
					uri: this.fileUrl(target),
					data: Buffer.from(content).toString("base64"),
					encoding: BASE64,
					contentType: "application/octet-stream",
					...expected?.kind === "createIfAbsent" ? { createOnly: true } : {},
					...expected?.kind === "replaceIfVersion" && existing?.resolved.etag !== void 0 ? { ifMatch: existing.resolved.etag } : {}
				});
			} catch (error) {
				if (error instanceof RpcError && error.code === AhpErrorCodes.AlreadyExists) throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, "FS_NOT_OBSERVED", { cause: error });
				throw mapFsError("write", target.displayPath, error);
			}
			throwIfAborted(signal, "write");
			const after = await this.probe(target, true);
			if (after === void 0) throw new FsError(`write did not publish "${target.displayPath}"`, "FS_IO_ERROR");
			return {
				operation: existing === void 0 ? "create" : "update",
				version: after.version,
				bytes: content.byteLength
			};
		});
	}
	async editText(target, edit, expected, signal, sandboxPolicy) {
		assertMutationAllowed(this.mapper, target, sandboxPolicy);
		return this.withLock(String(target.targetKey), async () => {
			throwIfAborted(signal, "edit");
			const existing = await this.probe(target, true);
			if (existing === void 0 || expected !== void 0 && existing.version !== expected.version) throw new FsError(`cannot edit "${target.displayPath}": file changed since it was read`, "FS_STALE_VERSION");
			if (resourceType(existing.resolved.type) !== "file") throw new FsError(`cannot edit "${target.displayPath}": not a regular file`, "FS_NOT_REGULAR_FILE");
			const stored = await this.readText(target, signal);
			const before = normalizeLineEndings(stored);
			const oldString = normalizeLineEndings(edit.oldString);
			if (oldString.length === 0) throw new FsError("old_string must be non-empty", "FS_EDIT_NOT_FOUND");
			const count = countOccurrences(before, oldString);
			if (count === 0) throw new FsError(`old_string was not found in "${target.displayPath}"`, "FS_EDIT_NOT_FOUND");
			if (!edit.replaceAll && count !== 1) throw new FsError(`old_string appears ${count} times in "${target.displayPath}"`, "FS_AMBIGUOUS_EDIT");
			const normalizedAfter = edit.replaceAll ? before.split(oldString).join(normalizeLineEndings(edit.newString)) : before.replace(oldString, normalizeLineEndings(edit.newString));
			const afterStorage = usesCrlf(stored) ? normalizedAfter.replaceAll("\n", "\r\n") : normalizedAfter;
			try {
				await (await this.remote.getClient()).resourceWrite({
					uri: this.fileUrl(target),
					data: afterStorage,
					encoding: UTF8$1,
					contentType: "text/plain; charset=utf-8",
					...existing.resolved.etag !== void 0 ? { ifMatch: existing.resolved.etag } : {}
				});
			} catch (error) {
				throw mapFsError("edit", target.displayPath, error);
			}
			throwIfAborted(signal, "edit");
			const afterProbe = await this.probe(target, true);
			if (afterProbe === void 0) throw new FsError(`edit did not publish "${target.displayPath}"`, "FS_IO_ERROR");
			return {
				version: afterProbe.version,
				before,
				after: normalizedAfter
			};
		});
	}
	target(remotePath) {
		const uri = fileUriFromPosixPath(remotePath);
		return {
			targetKey: FsTargetKey(uri),
			displayPath: posix.normalize(remotePath)
		};
	}
	async resolveUri(uri, followSymlinks) {
		return (await this.remote.getClient()).resourceResolve({
			uri,
			followSymlinks
		});
	}
	async probe(target, followSymlinks) {
		try {
			const resolved = await this.resolveUri(this.fileUrl(target), followSymlinks);
			return {
				resolved,
				version: versionOf(resolved)
			};
		} catch (error) {
			if (isNotFound(error)) return void 0;
			throw mapFsError("stat", target.displayPath, error);
		}
	}
	async withLock(key, operation) {
		const run = (this.locks.get(key) ?? Promise.resolve()).then(operation, operation);
		const tail = run.then(() => void 0, () => void 0);
		this.locks.set(key, tail);
		try {
			return await run;
		} finally {
			if (this.locks.get(key) === tail) this.locks.delete(key);
		}
	}
};
function assertMutationAllowed(mapper, target, policy) {
	if (policy === void 0 || policy.mode === "danger-full-access") return;
	if (policy.mode === "read-only") throw new FsError(`remote mutation denied for \"${target.displayPath}\" by read-only mode`, "FS_SANDBOX_DENIED");
	const workspace = mapper.toRemotePath(policy.workspaceRoot);
	const path = posixPathFromFileUri(String(target.targetKey));
	const rel = posix.relative(workspace, path);
	if (rel === ".." || rel.startsWith("../") || posix.isAbsolute(rel)) throw new FsError(`remote mutation denied outside workspace: \"${target.displayPath}\"`, "FS_SANDBOX_DENIED");
}
function requireRuntimeMapper(remote) {
	if (remote.mapper !== void 0) return remote.mapper;
	try {
		return remote.getMapper();
	} catch (error) {
		throw new Error("dsh-ssh-control/fs: a workspace mapping is required when the shared host runtime has no default mapper", { cause: error });
	}
}
function versionOf(result) {
	return FsVersion(result.etag ?? JSON.stringify([
		result.uri,
		result.type,
		result.size,
		result.mtime,
		result.ctime
	]));
}
function resourceType(type) {
	if (type === "file") return "file";
	if (type === "directory") return "directory";
	return "other";
}
function isNotFound(error) {
	return error instanceof RpcError && error.code === AhpErrorCodes.NotFound;
}
function mapFsError(operation, path, error) {
	if (error instanceof FsError) return error;
	if (error instanceof RpcError) {
		if (error.code === AhpErrorCodes.NotFound) return new FsError(`${operation} failed for "${path}": not found`, "FS_NOT_FOUND", { cause: error });
		if (error.code === AhpErrorCodes.PermissionDenied) return new FsError(`${operation} denied for "${path}"`, "FS_PERMISSION_DENIED", { cause: error });
		if (error.code === AhpErrorCodes.Conflict) return new FsError(`${operation} failed for "${path}": file changed`, "FS_STALE_VERSION", { cause: error });
	}
	return new FsError(`${operation} failed for "${path}": ${errorMessage$1(error)}`, "FS_IO_ERROR", { cause: error });
}
function throwIfAborted(signal, operation) {
	if (signal?.aborted) throw new FsError(`${operation} aborted`, "FS_ABORTED", { cause: signal.reason });
}
function decodeText(bytes, path) {
	if (bytes.includes(0)) throw new FsError(`cannot read "${path}": file contains NUL bytes`, "FS_NOT_TEXT");
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch (error) {
		throw new FsError(`cannot read "${path}": file is not valid UTF-8`, "FS_NOT_TEXT", { cause: error });
	}
}
function normalizeLineEndings(value) {
	return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}
function usesCrlf(value) {
	return value.includes("\r\n") && !value.replaceAll("\r\n", "").includes("\n");
}
function countOccurrences(haystack, needle) {
	let count = 0;
	let offset = 0;
	while ((offset = haystack.indexOf(needle, offset)) !== -1) {
		count += 1;
		offset += needle.length;
	}
	return count;
}
function errorMessage$1(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
//#region src/transport/shell.ts
const UTF8 = "utf-8";
var RemoteSshShellExecutor = class extends ShellExecutor {
	static inject = ["remoteSsh"];
	static Config = z.object({
		defaultTimeoutMs: z.number().default(12e4),
		maxTimeoutMs: z.number().default(6e5),
		outputMaxBytes: z.number().default(262144),
		maxOutputMaxBytes: z.number().default(16777216),
		shellCommand: z.string().default("bash"),
		localWorkspace: z.string(),
		remoteWorkspace: z.string()
	});
	config;
	remote;
	mapper;
	processes = /* @__PURE__ */ new Set();
	constructor(ctx, config) {
		super(ctx);
		this.remote = ctx.remoteSsh;
		this.config = config;
		if (config.localWorkspace === void 0 !== (config.remoteWorkspace === void 0)) throw new Error("dsh-ssh-control/shell: localWorkspace and remoteWorkspace must be configured together");
		this.mapper = config.localWorkspace !== void 0 && config.remoteWorkspace !== void 0 ? new WorkspacePathMapper(config.localWorkspace, config.remoteWorkspace) : mapperOf(this.remote);
		this.validate();
		ctx.effect(() => async () => {
			for (const process of this.processes) process.kill();
			await Promise.allSettled([...this.processes].map((process) => process.done));
		}, "Remote SSH shell teardown");
	}
	resolve(request) {
		const timeoutMs = clampPositive(request.timeoutMs ?? this.config.defaultTimeoutMs, this.config.maxTimeoutMs, "timeoutMs");
		const stdoutMaxBytes = clampPositive(request.stdoutMaxBytes ?? this.config.outputMaxBytes, this.config.maxOutputMaxBytes, "stdoutMaxBytes");
		return {
			command: request.command,
			workdir: request.workdir ?? this.mapper.localWorkspace,
			timeoutMs,
			stdoutMaxBytes,
			signal: request.signal,
			stdin: request.stdin,
			env: request.env,
			dshEnv: request.dshEnv,
			sandboxPolicy: request.sandboxPolicy
		};
	}
	async run(spec) {
		const outcome = await executeTerminal(this.remote, this.mapper, this.config.shellCommand, spec, spec.stdoutMaxBytes, spec.timeoutMs);
		return {
			exitCode: outcome.exitCode,
			signal: outcome.signal,
			timedOut: outcome.timedOut,
			aborted: outcome.aborted,
			timeoutMs: spec.timeoutMs,
			stdout: outcome.output.collected(),
			stderr: {
				text: "",
				truncated: false
			}
		};
	}
	start(spec) {
		const process = new AhpShellProcess(this.remote, this.mapper, this.config.shellCommand, spec, this.config.outputMaxBytes);
		this.processes.add(process);
		process.done.finally(() => {
			this.processes.delete(process);
		});
		return process;
	}
	validate() {
		for (const name of [
			"defaultTimeoutMs",
			"maxTimeoutMs",
			"outputMaxBytes",
			"maxOutputMaxBytes"
		]) {
			const value = this.config[name];
			if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`dsh-ssh-control/shell: ${name} must be a positive integer`);
		}
		if (this.config.defaultTimeoutMs > this.config.maxTimeoutMs) throw new Error("dsh-ssh-control/shell: defaultTimeoutMs exceeds maxTimeoutMs");
		if (this.config.outputMaxBytes > this.config.maxOutputMaxBytes) throw new Error("dsh-ssh-control/shell: outputMaxBytes exceeds maxOutputMaxBytes");
		if (this.config.shellCommand.trim().length === 0) throw new Error("dsh-ssh-control/shell: shellCommand must be non-empty");
	}
};
var AhpShellProcess = class {
	status = "running";
	exitCode = null;
	signal = null;
	done;
	controller = new AbortController();
	output;
	constructor(remote, mapper, shellCommand, spec, outputMaxBytes) {
		this.output = new TailBuffer(outputMaxBytes);
		this.done = executeTerminal(remote, mapper, shellCommand, {
			...spec,
			signal: combineSignals(spec.signal, this.controller.signal)
		}, outputMaxBytes, 0, this.output).then((outcome) => {
			this.exitCode = outcome.exitCode;
			this.signal = outcome.signal;
			this.status = outcome.signal === null ? "completed" : "killed";
		}, (error) => {
			this.output.append(`\n[dsh-ssh-control infrastructure error] ${errorMessage(error)}\n`);
			this.exitCode = null;
			this.signal = "SIGTERM";
			this.status = "killed";
		});
	}
	readOutput() {
		return this.output.readIncremental();
	}
	kill() {
		if (this.status !== "running" || this.controller.signal.aborted) return false;
		this.controller.abort(/* @__PURE__ */ new Error("background process killed"));
		return true;
	}
};
async function executeTerminal(remote, mapper, shellCommand, spec, outputMaxBytes, timeoutMs, existingOutput) {
	const output = existingOutput ?? new TailBuffer(outputMaxBytes);
	if (spec.sandboxPolicy !== void 0 && spec.sandboxPolicy.mode !== "danger-full-access") throw new Error(`dsh-ssh-control/shell: ${spec.sandboxPolicy.mode} cannot confine arbitrary remote commands; use danger-full-access or a separately sandboxed SSH account`);
	let client;
	try {
		client = await remote.getClient();
	} catch (_error) {
		return executeDirectSsh(remote, mapper, spec, outputMaxBytes, timeoutMs, output);
	}
	const token = randomUUID();
	const terminalUri = `ahp-terminal:/${token}`;
	const commandPath = posix.join(remote.runtimeRoot, `command-${token}.sh`);
	const stdinPath = posix.join(remote.runtimeRoot, `stdin-${token}.bin`);
	const commandUri = fileUriFromPosixPath(commandPath);
	const stdinUri = fileUriFromPosixPath(stdinPath);
	const workdir = mapper.toRemotePath(spec.workdir);
	let subscription;
	let terminalCreated = false;
	let stdinCreated = false;
	let timer;
	let abortListener;
	let stopCause;
	let resolveStop;
	const stopped = new Promise((resolvePromise) => {
		resolveStop = resolvePromise;
	});
	const stop = (cause) => {
		if (stopCause !== void 0) return;
		stopCause = cause;
		resolveStop?.(cause);
	};
	try {
		if (spec.signal?.aborted) stop("abort");
		await client.resourceWrite({
			uri: commandUri,
			data: spec.command,
			encoding: UTF8,
			contentType: "text/x-shellscript"
		});
		if (spec.stdin !== void 0) {
			await client.resourceWrite({
				uri: stdinUri,
				data: Buffer.from(spec.stdin).toString("base64"),
				encoding: "base64"
			});
			stdinCreated = true;
		}
		const claim = {
			kind: "client",
			clientId: remote.clientId
		};
		await client.request("createTerminal", {
			channel: terminalUri,
			claim,
			name: "DeepSeek Harness Remote SSH",
			cwd: fileUriFromPosixPath(workdir),
			cols: 120,
			rows: 30
		});
		terminalCreated = true;
		subscription = (await client.subscribe(terminalUri)).subscription;
		if (timeoutMs > 0) timer = setTimeout(() => {
			stop("timeout");
		}, timeoutMs);
		if (spec.signal !== void 0) {
			abortListener = () => {
				stop("abort");
			};
			spec.signal.addEventListener("abort", abortListener, { once: true });
		}
		const env = mergeEnvironment(mapper, spec);
		const envArgs = Object.entries(env).map(([key, value]) => `${key}=${quotePosix(value)}`).join(" ");
		const stdinRedirect = stdinCreated ? quotePosix(stdinPath) : "/dev/null";
		const marker = new TerminalOutputCapture(token, output);
		const input = `printf '\\036DSH:${token}:BEGIN\\037'; env ${envArgs} ${quotePosix(shellCommand)} ${quotePosix(commandPath)} < ${stdinRedirect}; __dsh_status=$?; printf '\\036DSH:${token}:END:%s\\037' "$__dsh_status"; exit "$__dsh_status"\r`;
		client.dispatch(terminalUri, {
			type: ActionType.TerminalInput,
			data: input
		});
		let commandId;
		for (;;) {
			const eventOrStop = await Promise.race([subscription.next().then((result) => ({
				kind: "event",
				result
			})), stopped.then((cause) => ({
				kind: "stop",
				cause
			}))]);
			if (eventOrStop.kind === "stop") {
				await client.request("disposeTerminal", { channel: terminalUri }).catch(() => {});
				terminalCreated = false;
				return {
					exitCode: null,
					signal: "SIGTERM",
					timedOut: eventOrStop.cause === "timeout",
					aborted: eventOrStop.cause === "abort",
					output
				};
			}
			if (eventOrStop.result.done) throw new Error("Agent Host terminal subscription ended before command completion");
			const event = eventOrStop.result.value;
			if (event.type !== "action") continue;
			const action = event.params.action;
			if (action.type === ActionType.TerminalCommandExecuted && commandId === void 0) commandId = action.commandId;
			else if (action.type === ActionType.TerminalData) {
				const exitCode = marker.push(action.data);
				if (exitCode !== void 0) return {
					exitCode,
					signal: null,
					timedOut: false,
					aborted: false,
					output
				};
			} else if (action.type === ActionType.TerminalCommandFinished && action.commandId === commandId && marker.started) continue;
			else if (action.type === ActionType.TerminalCommandFinished && commandId === void 0) continue;
			else if (action.type === ActionType.TerminalCommandFinished && action.commandId === commandId) return {
				exitCode: action.exitCode ?? null,
				signal: null,
				timedOut: false,
				aborted: false,
				output
			};
			else if (action.type === ActionType.TerminalExited) {
				if (!marker.finished) throw new Error(`Agent Host terminal exited before the output marker (exit ${action.exitCode ?? "unknown"})`);
				return {
					exitCode: action.exitCode ?? null,
					signal: action.exitCode === void 0 ? "SIGTERM" : null,
					timedOut: false,
					aborted: false,
					output
				};
			}
		}
	} finally {
		if (timer !== void 0) clearTimeout(timer);
		if (abortListener !== void 0) spec.signal?.removeEventListener("abort", abortListener);
		await subscription?.close().catch(() => {});
		if (terminalCreated) await client.request("disposeTerminal", { channel: terminalUri }).catch(() => {});
		await client.resourceDelete({ uri: commandUri }).catch(() => {});
		if (stdinCreated) await client.resourceDelete({ uri: stdinUri }).catch(() => {});
	}
}
var TerminalOutputCapture = class {
	output;
	begin;
	endPrefix;
	started = false;
	finished = false;
	pending = "";
	constructor(token, output) {
		this.output = output;
		this.begin = `\x1eDSH:${token}:BEGIN\x1f`;
		this.endPrefix = `\x1eDSH:${token}:END:`;
	}
	push(data) {
		if (this.finished) return void 0;
		this.pending += data;
		if (!this.started) {
			const at = this.pending.indexOf(this.begin);
			if (at === -1) {
				this.pending = this.pending.slice(-Math.max(0, this.begin.length - 1));
				return;
			}
			this.started = true;
			this.pending = this.pending.slice(at + this.begin.length);
		}
		const end = this.pending.indexOf(this.endPrefix);
		if (end === -1) {
			const safe = Math.max(0, this.pending.length - (this.endPrefix.length - 1));
			if (safe > 0) {
				this.output.append(this.pending.slice(0, safe));
				this.pending = this.pending.slice(safe);
			}
			return;
		}
		this.output.append(this.pending.slice(0, end));
		const statusStart = end + this.endPrefix.length;
		const terminator = this.pending.indexOf("", statusStart);
		if (terminator === -1) {
			this.pending = this.pending.slice(end);
			return;
		}
		const raw = this.pending.slice(statusStart, terminator);
		if (!/^\d+$/.test(raw)) throw new Error(`Agent Host terminal emitted an invalid exit marker: ${JSON.stringify(raw)}`);
		this.finished = true;
		this.pending = "";
		return Number(raw);
	}
};
function mergeEnvironment(mapper, spec) {
	const result = {
		...spec.env ?? {},
		...spec.dshEnv ?? {}
	};
	if (result.DSH_CWD !== void 0) result.DSH_CWD = mapper.toRemotePath(result.DSH_CWD);
	for (const key of Object.keys(result)) {
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`invalid remote environment variable name: ${key}`);
		if (result[key]?.includes("\0")) throw new Error(`remote environment variable ${key} contains a NUL byte`);
	}
	return result;
}
var TailBuffer = class {
	maxBytes;
	tail = Buffer.alloc(0);
	tailStart = 0;
	total = 0;
	readOffset = 0;
	constructor(maxBytes) {
		this.maxBytes = maxBytes;
	}
	append(value) {
		const chunk = Buffer.from(value);
		this.total += chunk.length;
		const combined = Buffer.concat([this.tail, chunk]);
		if (combined.length > this.maxBytes) {
			const dropped = combined.length - this.maxBytes;
			this.tail = combined.subarray(dropped);
			this.tailStart += dropped;
		} else this.tail = combined;
	}
	collected() {
		return {
			text: this.tail.toString("utf8"),
			truncated: this.tailStart > 0
		};
	}
	readIncremental() {
		const lossy = this.readOffset < this.tailStart;
		const start = Math.max(this.readOffset, this.tailStart) - this.tailStart;
		const delta = this.tail.subarray(start).toString("utf8");
		this.readOffset = this.total;
		return {
			delta,
			lossy
		};
	}
};
function clampPositive(value, max, name) {
	if (!Number.isFinite(value) || value <= 0) throw new Error(`dsh-ssh-control/shell: ${name} must be positive`);
	return Math.min(Math.floor(value), max);
}
function combineSignals(first, second) {
	return first === void 0 ? second : AbortSignal.any([first, second]);
}
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
function mapperOf(remote) {
	return remote.mapper ?? remote.getMapper();
}
async function executeDirectSsh(remote, mapper, spec, _outputMaxBytes, timeoutMs, output) {
	let workdir;
	try {
		workdir = mapper.toRemotePath(spec.workdir);
	} catch {
		workdir = mapper.remoteWorkspace;
	}
	const env = mergeEnvironment(mapper, spec);
	const envArgs = Object.entries(env).map(([k, v]) => `${k}=${quotePosix(v)}`).join(" ");
	const wrappedCommand = `${`if [ -d ${quotePosix(workdir)} ] && cd ${quotePosix(workdir)} 2>/dev/null; then :; elif [ -d ${quotePosix(mapper.remoteWorkspace)} ] && cd ${quotePosix(mapper.remoteWorkspace)} 2>/dev/null; then :; else cd ~ || cd /; fi`} && env ${envArgs} bash -c ${quotePosix(spec.command)}`;
	const args = [
		...remote.config.sshArgs,
		remote.config.sshTarget,
		wrappedCommand
	];
	const child = spawn(remote.config.sshExecutable, args, { stdio: [
		spec.stdin !== void 0 ? "pipe" : "ignore",
		"pipe",
		"pipe"
	] });
	let timedOut = false;
	let aborted = false;
	let timer;
	if (timeoutMs > 0) timer = setTimeout(() => {
		timedOut = true;
		child.kill("SIGTERM");
	}, timeoutMs);
	const abortHandler = () => {
		aborted = true;
		child.kill("SIGTERM");
	};
	if (spec.signal !== void 0) spec.signal.addEventListener("abort", abortHandler, { once: true });
	if (spec.stdin !== void 0 && child.stdin) child.stdin.end(spec.stdin);
	child.stdout?.on("data", (chunk) => {
		output.append(chunk.toString("utf8"));
	});
	child.stderr?.on("data", (chunk) => {
		output.append(chunk.toString("utf8"));
	});
	return {
		exitCode: await new Promise((resolvePromise) => {
			child.on("close", (code) => {
				if (timer !== void 0) clearTimeout(timer);
				if (spec.signal !== void 0) spec.signal.removeEventListener("abort", abortHandler);
				resolvePromise(code);
			});
			child.on("error", () => {
				if (timer !== void 0) clearTimeout(timer);
				if (spec.signal !== void 0) spec.signal.removeEventListener("abort", abortHandler);
				resolvePromise(null);
			});
		}),
		signal: timedOut || aborted ? "SIGTERM" : null,
		timedOut,
		aborted,
		output
	};
}
//#endregion
//#region src/routing/manager.ts
const SETTINGS_NAMESPACE = settingsNamespace("remote-ssh");
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const serverSchema = z.object({
	id: z.string().required(),
	label: z.string().required(),
	sshTarget: z.string().required(),
	sshArgs: z.array(z.string()),
	remoteCodeCommand: z.string(),
	sshExecutable: z.string(),
	backendPort: z.number()
});
const workspaceSchema = z.object({
	id: z.string().required(),
	serverId: z.string().required(),
	remotePath: z.string().required(),
	aliasPath: z.string(),
	title: z.string()
});
/**
* Owns the durable host/workspace catalog and lazy remote workspace contexts.
* An alias that was once remote remains a remote tombstone after removal, so
* stale sessions fail closed instead of silently running on the local host.
*/
var RemoteSshManager = class RemoteSshManager extends Service {
	static inject = ["settings"];
	static Config = z.object({
		aliasRoot: z.string().default(resolve(process.env.DSH_HOME ?? resolve(process.env.USERPROFILE ?? ".", ".dsh"), "remote-ssh", "workspaces")),
		sshConfigFile: z.string(),
		servers: z.array(serverSchema).default([]),
		workspaces: z.array(workspaceSchema).default([]),
		openFileMode: z.union([
			"auto",
			"vscode",
			"cursor",
			"windsurf",
			"vscodium",
			"custom",
			"download"
		]).default("auto"),
		openFileEditorPath: z.string(),
		openFileDownloadMaxBytes: z.number().default(67108864),
		startupTimeoutMs: z.number().default(6e5),
		requestTimeoutMs: z.number().default(3e4),
		defaultServerId: z.string(),
		autoConnect: z.boolean().default(false)
	});
	entry;
	current;
	settings;
	routes = /* @__PURE__ */ new Map();
	routeByWorkspaceId = /* @__PURE__ */ new Map();
	remoteAliases = /* @__PURE__ */ new Set();
	contexts = /* @__PURE__ */ new Map();
	shellContexts = /* @__PURE__ */ new Map();
	hosts = /* @__PURE__ */ new Map();
	backendTunnels = /* @__PURE__ */ new Map();
	webProxies = /* @__PURE__ */ new Map();
	backendProgress = /* @__PURE__ */ new Map();
	backendProgressListeners = /* @__PURE__ */ new Map();
	sessionWorlds = /* @__PURE__ */ new Map();
	workspaceRegistry;
	refreshTail = Promise.resolve();
	initialRefresh;
	constructor(ctx, config) {
		super(ctx, "remoteSshManager");
		this.entry = {
			aliasRoot: config.aliasRoot ?? resolve(process.env.DSH_HOME ?? resolve(process.env.USERPROFILE ?? ".", ".dsh"), "remote-ssh", "workspaces"),
			servers: config.servers ?? [],
			workspaces: config.workspaces ?? [],
			openFileMode: config.openFileMode ?? "auto",
			openFileDownloadMaxBytes: config.openFileDownloadMaxBytes ?? 67108864,
			startupTimeoutMs: config.startupTimeoutMs ?? 6e5,
			requestTimeoutMs: config.requestTimeoutMs ?? 3e4,
			autoConnect: config.autoConnect ?? false,
			...config.sshConfigFile !== void 0 ? { sshConfigFile: config.sshConfigFile } : {},
			...config.openFileEditorPath !== void 0 ? { openFileEditorPath: config.openFileEditorPath } : {},
			...config.defaultServerId !== void 0 ? { defaultServerId: config.defaultServerId } : {}
		};
		this.current = this.entry;
		this.validate(this.entry);
		this.initialRefresh = this.queueRefresh(this.entry);
		ctx.inject(["workspaceRegistry"], (workspaceCtx) => {
			this.workspaceRegistry = workspaceCtx.workspaceRegistry;
			this.registerAllWorkspaces().catch((error) => {
				this.ctx.logger.error(error);
			});
			workspaceCtx.effect(() => () => {
				if (this.workspaceRegistry === workspaceCtx.workspaceRegistry) this.workspaceRegistry = void 0;
			}, "Remote SSH workspace registry attachment");
		});
		const scope = ctx.settings.register(SETTINGS_NAMESPACE, RemoteSshManager.Config, {
			base: this.entry,
			applies: "live",
			validate: (value) => {
				this.validate(value);
			}
		});
		this.settings = scope;
		this.queueRefresh(scope.get());
		const unwatch = scope.watch((next) => this.queueRefresh(next));
		ctx.effect(() => () => {
			unwatch();
			if (this.settings === scope) this.settings = void 0;
		}, "Remote SSH settings watch");
		ctx.effect(() => async () => {
			await this.refreshTail;
			const contexts = await Promise.allSettled(this.contexts.values());
			await Promise.allSettled(contexts.flatMap((result) => result.status === "fulfilled" ? [result.value.ctx.fiber.dispose()] : []));
			this.contexts.clear();
			const shells = await Promise.allSettled(this.shellContexts.values());
			await Promise.allSettled(shells.flatMap((result) => result.status === "fulfilled" ? [result.value.ctx.fiber.dispose()] : []));
			this.shellContexts.clear();
			const hosts = await Promise.allSettled(this.hosts.values());
			await Promise.allSettled(hosts.flatMap((result) => result.status === "fulfilled" ? [this.disposeHost(result.value)] : []));
			this.hosts.clear();
			const proxies = await Promise.allSettled(this.webProxies.values());
			await Promise.allSettled(proxies.flatMap((result) => result.status === "fulfilled" ? [result.value.dispose()] : []));
			this.webProxies.clear();
			const tunnels = await Promise.allSettled(this.backendTunnels.values());
			await Promise.allSettled(tunnels.flatMap((result) => result.status === "fulfilled" ? [result.value.dispose()] : []));
			this.backendTunnels.clear();
			this.backendProgressListeners.clear();
		}, "Remote SSH workspace context teardown");
	}
	/** Wait until the composition-layer catalog has published its aliases. */
	async [Service.init]() {
		await this.initialRefresh;
	}
	/** Current detached catalog snapshot. */
	snapshot() {
		return structuredClone(this.current);
	}
	/** Select one custom OpenSSH config, or restore the platform defaults. */
	async setSshConfigFile(path) {
		await this.updateUserPreferences({ sshConfigFile: path ?? "" });
	}
	/** Update the native remote editor preference and its download fallback limit. */
	async setOpenFileSettings(input) {
		await this.updateUserPreferences({
			openFileMode: input.mode,
			openFileEditorPath: input.editorPath ?? ""
		});
	}
	/** Atomically update user-facing plugin preferences. Empty paths clear overrides. */
	async updateUserPreferences(input) {
		const next = this.snapshot();
		if (input.sshConfigFile !== void 0) {
			if (input.sshConfigFile.trim() === "") delete next.sshConfigFile;
			else next.sshConfigFile = input.sshConfigFile.trim();
		}
		if (input.openFileMode !== void 0) next.openFileMode = input.openFileMode;
		if (input.openFileEditorPath !== void 0) {
			if (input.openFileEditorPath.trim() === "") delete next.openFileEditorPath;
			else next.openFileEditorPath = input.openFileEditorPath.trim();
		}
		if (input.defaultServerId !== void 0) {
			if (input.defaultServerId.trim() === "") delete next.defaultServerId;
			else next.defaultServerId = input.defaultServerId.trim();
		}
		if (input.autoConnect !== void 0) next.autoConnect = input.autoConnect;
		this.validate(next);
		await this.replaceSettings(next);
	}
	/** Discover all available servers from settings and OpenSSH config. */
	async listAvailableServers() {
		const snapshot = this.snapshot();
		const configFiles = snapshot.sshConfigFile === void 0 ? defaultSshConfigFiles() : [snapshot.sshConfigFile];
		const discovered = await discoverSshConfigHosts(configFiles).catch(() => ({
			hosts: [],
			files: [],
			errors: []
		}));
		const results = /* @__PURE__ */ new Map();
		for (const host of discovered.hosts) results.set(host.sshTarget.toLowerCase(), {
			id: host.id,
			label: host.label,
			sshTarget: host.sshTarget,
			source: "config",
			hostName: host.hostName,
			user: host.user,
			port: host.port,
			isDefault: snapshot.defaultServerId === host.id || snapshot.defaultServerId === host.sshTarget
		});
		for (const server of snapshot.servers) results.set(server.sshTarget.toLowerCase(), {
			id: server.id,
			label: server.label,
			sshTarget: server.sshTarget,
			source: "settings",
			isDefault: snapshot.defaultServerId === server.id || snapshot.defaultServerId === server.sshTarget
		});
		return [...results.values()].sort((a, b) => a.label.localeCompare(b.label));
	}
	/** Find or dynamically create an SSH server definition. */
	async findOrCreateServer(target) {
		const snapshot = this.snapshot();
		const normalized = target?.trim();
		if (!normalized) {
			if (snapshot.defaultServerId) {
				const def = snapshot.servers.find((s) => s.id === snapshot.defaultServerId || s.sshTarget.toLowerCase() === snapshot.defaultServerId?.toLowerCase());
				if (def) return def;
			}
			if (snapshot.servers.length > 0) return snapshot.servers[0];
			const available = await this.listAvailableServers();
			if (available.length > 0) {
				const first = available[0];
				return this.addServer({
					id: first.id,
					label: first.label,
					sshTarget: first.sshTarget
				});
			}
			throw new Error("dsh-ssh-control: no SSH server configured or discovered in OpenSSH config");
		}
		const existing = snapshot.servers.find((s) => s.id === normalized || s.sshTarget.toLowerCase() === normalized.toLowerCase() || s.label.toLowerCase() === normalized.toLowerCase());
		if (existing) return existing;
		const matched = (await this.listAvailableServers()).find((s) => s.id === normalized || s.sshTarget.toLowerCase() === normalized.toLowerCase() || s.label.toLowerCase() === normalized.toLowerCase());
		if (matched) return this.addServer({
			id: matched.id,
			label: matched.label,
			sshTarget: matched.sshTarget
		});
		return this.addServer({
			label: normalized,
			sshTarget: normalized
		});
	}
	/** Find or dynamically create an in-memory ephemeral workspace route for a session attach without polluting workspace registry. */
	async findOrCreateWorkspace(server, remotePath) {
		let targetPath = remotePath?.trim();
		if (!targetPath) {
			const existingWf = this.snapshot().workspaces.find((w) => w.serverId === server.id);
			if (existingWf) {
				const route = this.routeByWorkspaceId.get(existingWf.id);
				if (route) return route;
				targetPath = existingWf.remotePath;
			} else {
				targetPath = "/";
				try {
					const connection = await (await this.hostContext(server)).remote.getConnection();
					if (connection.defaultDirectory) targetPath = posixPathFromFileUri(String(connection.defaultDirectory));
				} catch {
					targetPath = "/";
				}
			}
		}
		const normalized = posix.normalize(targetPath);
		for (const route of this.routeByWorkspaceId.values()) if (route.server.id === server.id && posix.normalize(route.workspace.remotePath) === normalized) return route;
		const tempId = `ephemeral-${randomUUID()}`;
		const aliasPath = resolve(this.current.aliasRoot, tempId);
		await mkdir(aliasPath, { recursive: true });
		const canonicalAlias = resolve(aliasPath);
		const route = {
			kind: "remote",
			server,
			workspace: {
				id: tempId,
				serverId: server.id,
				remotePath: normalized
			},
			aliasPath: canonicalAlias,
			mapper: new WorkspacePathMapper(canonicalAlias, normalized)
		};
		this.routes.set(normalizeLocal(canonicalAlias), route);
		this.routeByWorkspaceId.set(tempId, route);
		this.remoteAliases.add(normalizeLocal(canonicalAlias));
		return route;
	}
	/** Dynamically attach/switch execution world for a session. */
	async attachSession(sessionId, target) {
		const server = await this.findOrCreateServer(target?.server);
		const route = await this.findOrCreateWorkspace(server, target?.path);
		const owner = this.sessionWorlds.get(sessionId)?.owner ?? this;
		this.sessionWorlds.set(sessionId, {
			owner,
			workspaceId: route.workspace.id
		});
		this.ctx.emit("remote-ssh/session-attached", {
			sessionId,
			route
		});
		return {
			status: "attached",
			sessionId,
			serverId: route.server.id,
			serverLabel: route.server.label,
			sshTarget: route.server.sshTarget,
			remotePath: route.workspace.remotePath,
			aliasPath: route.aliasPath
		};
	}
	/** Detach a session from remote execution and switch back to local. */
	async detachSession(sessionId) {
		const owner = this.sessionWorlds.get(sessionId)?.owner ?? this;
		this.sessionWorlds.set(sessionId, {
			owner,
			workspaceId: null
		});
		this.ctx.emit("remote-ssh/session-detached", { sessionId });
		return {
			status: "detached",
			sessionId,
			message: "Switched back to local workspace execution."
		};
	}
	/** Get session execution world status and connection info. */
	sessionStatus(sessionId) {
		const route = this.sessionRoute(sessionId);
		if (route === void 0 || route.kind === "local") return {
			sessionId,
			executionWorld: "local",
			status: "ready (local execution)"
		};
		return {
			sessionId,
			executionWorld: "remote",
			server: {
				id: route.server.id,
				label: route.server.label,
				sshTarget: route.server.sshTarget
			},
			remotePath: route.workspace.remotePath,
			aliasPath: route.aliasPath,
			status: "ready (transparent remote execution)"
		};
	}
	/** Browse directories through the server's shared AHP filesystem connection. */
	async listRemoteDirectory(server, requestedPath) {
		const connection = await (await this.hostContext(server)).remote.getConnection();
		const home = connection.defaultDirectory === void 0 ? "/" : posixPathFromFileUri(String(connection.defaultDirectory));
		const path = posix.normalize(requestedPath?.trim() || home);
		if (!posix.isAbsolute(path)) throw new Error("remote directory path must be an absolute POSIX path");
		const listed = await connection.client.resourceList({ uri: fileUriFromPosixPath(path) });
		return {
			path,
			home,
			...path === "/" ? {} : { parent: posix.dirname(path) },
			entries: listed.entries.filter((entry) => entry.type === "directory").sort((left, right) => left.name.localeCompare(right.name)).map((entry) => ({
				name: entry.name,
				path: posix.join(path, entry.name)
			}))
		};
	}
	/** Create a server entry through the settings provider. */
	async addServer(input) {
		const server = {
			...input,
			id: input.id ?? randomUUID()
		};
		const next = this.snapshot();
		next.servers.push(server);
		this.validate(next);
		await this.replaceSettings(next);
		return server;
	}
	/** Create and register one remote workspace alias. */
	async addWorkspace(serverId, remotePath) {
		const workspace = {
			id: randomUUID(),
			serverId,
			remotePath
		};
		const next = this.snapshot();
		next.workspaces.push(workspace);
		this.validate(next);
		await this.replaceSettings(next);
		await this.refreshTail;
		const route = this.routeByWorkspaceId.get(workspace.id);
		if (route === void 0) throw new Error(`remote workspace '${workspace.id}' was not published`);
		return route;
	}
	/** Rename one remote workspace without changing its execution route. */
	async renameWorkspace(id, title) {
		const normalizedTitle = title.trim();
		if (normalizedTitle.length === 0) throw new Error("remote workspace title must not be empty");
		const next = this.snapshot();
		const workspace = next.workspaces.find((candidate) => candidate.id === id);
		if (workspace === void 0) throw new Error(`dsh-ssh-control: unknown remote workspace '${id}'`);
		workspace.title = normalizedTitle;
		this.validate(next);
		await this.replaceSettings(next);
		const route = this.routeByWorkspaceId.get(id);
		if (route === void 0) throw new Error(`remote workspace '${id}' was not published`);
		return route;
	}
	/** Remove execution routing while retaining alias, Workspace, and Session history. */
	async removeWorkspace(id) {
		const next = this.snapshot();
		const before = next.workspaces.length;
		next.workspaces = next.workspaces.filter((workspace) => workspace.id !== id);
		if (next.workspaces.length === before) return false;
		await this.replaceSettings(next);
		return true;
	}
	/** Remove one server and tombstone all of its workspace execution routes. */
	async removeServer(id) {
		const next = this.snapshot();
		const before = next.servers.length;
		next.servers = next.servers.filter((server) => server.id !== id);
		if (next.servers.length === before) return false;
		next.workspaces = next.workspaces.filter((workspace) => workspace.serverId !== id);
		await this.replaceSettings(next);
		return true;
	}
	/** Pre-register a local directory with the stable LOCAL display prefix. */
	async adoptLocalWorkspace(path) {
		const registry = this.workspaceRegistry;
		if (registry === void 0) throw new Error("dsh-ssh-control: workspace registry is unavailable");
		const absolute = resolve(path);
		const title = `LOCAL > ${basename(absolute)}`;
		const workspace = await registry.create(absolute, title);
		if (workspace.title !== title) await workspace.setTitle(title);
		return workspace.path;
	}
	/** Resolve a tool path/cwd into the only execution world allowed to handle it. */
	route(path, cwd) {
		const cwdRoute = cwd === void 0 ? void 0 : this.findAlias(cwd);
		if (cwdRoute !== void 0) return cwdRoute;
		if (cwd !== void 0 && this.wasRemoteAlias(cwd)) throw new Error(`dsh-ssh-control: workspace alias is no longer configured: ${cwd}`);
		if (path !== void 0 && isAbsolute(path)) {
			const pathRoute = this.findAlias(path);
			if (pathRoute !== void 0) return pathRoute;
			if (this.wasRemoteAlias(path)) throw new Error(`dsh-ssh-control: workspace alias is no longer configured: ${path}`);
		}
		const remotePathRoute = cwd === void 0 ? void 0 : this.findRemotePath(cwd);
		if (remotePathRoute !== void 0) return remotePathRoute;
		const absoluteRemotePathRoute = path === void 0 ? void 0 : this.findRemotePath(path);
		if (absoluteRemotePathRoute !== void 0) return absoluteRemotePathRoute;
		return { kind: "local" };
	}
	/** Pin shell dispatch to the session workspace, regardless of an explicit tool workdir. */
	bindSession(sessionId, owner, cwd) {
		if (cwd !== void 0 && this.wasRemoteAlias(cwd)) {
			const route = this.findAlias(cwd);
			if (route !== void 0) {
				this.sessionWorlds.set(sessionId, {
					owner,
					workspaceId: route.workspace.id
				});
				return route;
			}
			this.sessionWorlds.set(sessionId, {
				owner,
				workspaceId: null,
				removedAlias: cwd
			});
			return;
		}
		let route = cwd === void 0 ? { kind: "local" } : this.route(void 0, cwd);
		if (route.kind === "local" && (this.current.autoConnect || this.current.defaultServerId !== void 0)) {
			const defaultServer = this.current.servers.find((s) => s.id === this.current.defaultServerId || s.sshTarget.toLowerCase() === this.current.defaultServerId?.toLowerCase()) ?? (this.current.autoConnect ? this.current.servers[0] : void 0);
			if (defaultServer !== void 0) {
				const defaultWf = this.current.workspaces.find((w) => w.serverId === defaultServer.id);
				if (defaultWf !== void 0) {
					const defaultRoute = this.routeByWorkspaceId.get(defaultWf.id);
					if (defaultRoute !== void 0) route = defaultRoute;
				}
			}
		}
		this.sessionWorlds.set(sessionId, {
			owner,
			workspaceId: route.kind === "remote" ? route.workspace.id : null
		});
		return route;
	}
	/** Release only the binding owned by this exact live Agent. */
	unbindSession(sessionId, owner) {
		if (this.sessionWorlds.get(sessionId)?.owner === owner) this.sessionWorlds.delete(sessionId);
	}
	/** Resolve the execution world bound to a live session without consulting path text. */
	sessionRoute(sessionId) {
		const bound = this.sessionWorlds.get(sessionId);
		if (bound === void 0) return void 0;
		if (bound.removedAlias !== void 0) throw new Error(`dsh-ssh-control: workspace alias is no longer configured: ${bound.removedAlias}`);
		return bound.workspaceId === null ? { kind: "local" } : this.workspace(bound.workspaceId);
	}
	/** Resolve shell calls using their durable session world before considering workdir text. */
	routeShell(workdir, sessionId) {
		const bound = sessionId === void 0 ? void 0 : this.sessionRoute(sessionId);
		if (bound !== void 0) return bound;
		return this.route(void 0, workdir);
	}
	/** Model-facing shell dialect for a workspace cwd. Remote workspaces are POSIX today. */
	dialectFor(cwd) {
		if (cwd !== void 0 && (this.findAlias(cwd) !== void 0 || this.wasRemoteAlias(cwd) || this.findRemotePath(cwd) !== void 0)) return "bash";
		return process.platform === "win32" ? "pwsh" : "bash";
	}
	/** Presentation-only logical cwd that never exposes the local UUID alias. */
	displayRemoteCwd(route, workdir) {
		const remotePath = workdir === void 0 || workdir.trim() === "" ? route.workspace.remotePath : route.mapper.toRemotePath(workdir, route.aliasPath);
		const normalized = posix.normalize(remotePath);
		const workspaceRoot = posix.normalize(route.workspace.remotePath);
		const relativePath = posix.relative(workspaceRoot, normalized);
		const workspaceTitle = route.workspace.title ?? `${route.server.label} > ${posix.basename(workspaceRoot) || workspaceRoot}`;
		if (relativePath === "" || relativePath !== ".." && !relativePath.startsWith("../") && !posix.isAbsolute(relativePath)) return posix.join("/", workspaceTitle, relativePath);
		return posix.join("/", `${route.server.label} > remote`, normalized);
	}
	/** Lookup a published route by its durable workspace id. */
	workspace(id) {
		const route = this.routeByWorkspaceId.get(id);
		if (route === void 0) throw new Error(`dsh-ssh-control: unknown or removed remote workspace '${id}'`);
		return route;
	}
	/** Lazily boot the AHP filesystem context for one remote workspace. */
	async workspaceContext(route) {
		let pending = this.contexts.get(route.workspace.id);
		if (pending === void 0) {
			pending = this.createWorkspaceContext(route);
			this.contexts.set(route.workspace.id, pending);
			pending.catch(() => {
				if (this.contexts.get(route.workspace.id) === pending) this.contexts.delete(route.workspace.id);
			});
		}
		return pending;
	}
	/** Resolve the SSH executable/options shared by all channels for this host. */
	sshTransport(route) {
		return this.transportFor(route.server);
	}
	/** Open the UI-neutral Host protocol over one persistent SSH forward. */
	async connectBackend(server) {
		const key = backendRuntimeKey(server);
		let pending = this.backendTunnels.get(key);
		if (pending !== void 0) {
			const existing = await pending.catch(() => void 0);
			if (existing?.alive === true) {
				if (!existing.connected) {
					this.publishBackendProgress(server, { stage: "reconnecting" });
					await existing.ready();
				}
				this.publishBackendProgress(server, { stage: "ready" });
				return existing;
			}
			if (existing !== void 0) await existing.dispose();
			this.backendTunnels.delete(key);
		}
		const transport = this.transportFor(server);
		this.publishBackendProgress(server, { stage: "connecting" });
		pending = RemoteDshHostConnection.open({
			sshExecutable: transport.executable,
			sshArgs: transport.args,
			sshTarget: server.sshTarget,
			remotePort: server.backendPort ?? DEFAULT_DSH_BACKEND_PORT,
			startupTimeoutMs: this.current.startupTimeoutMs,
			onProgress: (progress) => {
				this.publishBackendProgress(server, progress);
			}
		});
		pending = pending.then((tunnel) => {
			this.publishBackendProgress(server, { stage: "ready" });
			return tunnel;
		}, (error) => {
			this.publishBackendProgress(server, {
				stage: "failed",
				error: (error instanceof Error ? error.message : String(error)).slice(0, 1e3)
			});
			throw error;
		});
		this.backendTunnels.set(key, pending);
		pending.catch(() => {
			if (this.backendTunnels.get(key) === pending) this.backendTunnels.delete(key);
		});
		return pending;
	}
	/** Observe one Host installation/attachment without requiring the Host to exist yet. */
	watchBackendProgress(server, listener) {
		const key = backendRuntimeKey(server);
		let listeners = this.backendProgressListeners.get(key);
		if (listeners === void 0) {
			listeners = /* @__PURE__ */ new Set();
			this.backendProgressListeners.set(key, listeners);
		}
		listeners.add(listener);
		const current = this.backendProgress.get(key);
		if (current !== void 0) listener(current);
		return () => {
			listeners?.delete(listener);
			if (listeners?.size === 0) this.backendProgressListeners.delete(key);
		};
	}
	publishBackendProgress(server, progress) {
		const key = backendRuntimeKey(server);
		this.backendProgress.set(key, progress);
		for (const listener of this.backendProgressListeners.get(key) ?? []) try {
			listener(progress);
		} catch {}
	}
	/** Open a typed, UI-neutral client on the shared Host tunnel. */
	async connectBackendClient(server) {
		return new RemoteDshHostClient(await this.connectBackend(server), this.current.requestTimeoutMs);
	}
	/** Serve the local Web assets while proxying the unchanged Host protocol. */
	async connectWebBackend(server, localUiPort) {
		const key = webBackendRuntimeKey(server, localUiPort);
		let pending = this.webProxies.get(key);
		if (pending !== void 0) {
			const existing = await pending.catch(() => void 0);
			if (existing?.alive === true) return existing;
			if (existing !== void 0) await existing.dispose();
			this.webProxies.delete(key);
		}
		const tunnel = await this.connectBackend(server);
		pending = RemoteDshWebProxy.attach(tunnel, localUiPort);
		this.webProxies.set(key, pending);
		pending.catch(() => {
			if (this.webProxies.get(key) === pending) this.webProxies.delete(key);
		});
		return pending;
	}
	/** AHP-backed shell view sharing the host runtime but retaining workspace path mapping. */
	async workspaceShell(route, dialect) {
		const key = `${route.workspace.id}:${dialect}`;
		let pending = this.shellContexts.get(key);
		if (pending === void 0) {
			pending = this.createWorkspaceShellContext(route, dialect);
			this.shellContexts.set(key, pending);
			pending.catch(() => {
				if (this.shellContexts.get(key) === pending) this.shellContexts.delete(key);
			});
		}
		return (await pending).shell;
	}
	queueRefresh(config) {
		const run = this.refreshTail.then(() => this.publish(config));
		this.refreshTail = run.then(() => {}, () => {});
		return run;
	}
	async publish(config) {
		this.validate(config);
		await mkdir(resolve(tmpdir(), "dsh-ssh"), { recursive: true });
		const servers = new Map(config.servers.map((server) => [server.id, server]));
		const nextRoutes = /* @__PURE__ */ new Map();
		const nextById = /* @__PURE__ */ new Map();
		for (const workspace of config.workspaces) {
			const server = servers.get(workspace.serverId);
			const aliasPath = resolve(workspace.aliasPath ?? resolve(config.aliasRoot, workspace.id));
			await mkdir(aliasPath, { recursive: true });
			const canonicalAlias = resolve(aliasPath);
			const route = {
				kind: "remote",
				server,
				workspace,
				aliasPath: canonicalAlias,
				mapper: new WorkspacePathMapper(canonicalAlias, workspace.remotePath)
			};
			nextRoutes.set(normalizeLocal(canonicalAlias), route);
			nextById.set(workspace.id, route);
			this.remoteAliases.add(normalizeLocal(canonicalAlias));
		}
		for (const [id, pending] of this.contexts) {
			const previous = this.routeByWorkspaceId.get(id);
			const next = nextById.get(id);
			if (previous === void 0 || next === void 0 || routeRuntimeKey(previous) !== routeRuntimeKey(next)) {
				const settled = await Promise.resolve(pending).catch(() => void 0);
				if (settled !== void 0) await settled.ctx.fiber.dispose();
				this.contexts.delete(id);
			}
		}
		for (const [key, pending] of this.shellContexts) {
			const id = key.slice(0, key.lastIndexOf(":"));
			const previous = this.routeByWorkspaceId.get(id);
			const next = nextById.get(id);
			if (previous === void 0 || next === void 0 || routeRuntimeKey(previous) !== routeRuntimeKey(next)) {
				const settled = await Promise.resolve(pending).catch(() => void 0);
				if (settled !== void 0) await settled.ctx.fiber.dispose();
				this.shellContexts.delete(key);
			}
		}
		for (const [id, pending] of this.hosts) {
			const next = servers.get(id);
			const settled = await Promise.resolve(pending).catch(() => void 0);
			if (next === void 0 || settled === void 0 || settled.key !== serverRuntimeKey(next)) {
				if (settled !== void 0) await this.disposeHost(settled);
				this.hosts.delete(id);
			}
		}
		for (const [key, pending] of this.webProxies) {
			const [serverId, expectedRuntimeKey] = JSON.parse(key);
			const next = servers.get(serverId);
			if (next === void 0 || serverRuntimeKey(next) !== expectedRuntimeKey) {
				const settled = await Promise.resolve(pending).catch(() => void 0);
				if (settled !== void 0) await settled.dispose();
				this.webProxies.delete(key);
			}
		}
		for (const [key, pending] of this.backendTunnels) {
			const [serverId, expectedRuntimeKey] = JSON.parse(key);
			const next = servers.get(serverId);
			if (next === void 0 || serverRuntimeKey(next) !== expectedRuntimeKey) {
				const settled = await Promise.resolve(pending).catch(() => void 0);
				if (settled !== void 0) await settled.dispose();
				this.backendTunnels.delete(key);
			}
		}
		this.routes.clear();
		this.routeByWorkspaceId.clear();
		for (const [key, value] of nextRoutes) this.routes.set(key, value);
		for (const [key, value] of nextById) this.routeByWorkspaceId.set(key, value);
		this.current = structuredClone(config);
		await this.registerAllWorkspaces();
	}
	async registerAllWorkspaces() {
		const registry = this.workspaceRegistry;
		if (registry === void 0) return;
		for (const route of this.routeByWorkspaceId.values()) {
			const title = route.workspace.title ?? `${route.server.label} > ${posix.basename(route.workspace.remotePath) || route.workspace.remotePath}`;
			const workspace = await registry.create(route.aliasPath, title);
			if (workspace.title !== title) await workspace.setTitle(title);
		}
	}
	findAlias(path) {
		const absolute = normalizeLocal(resolve(path));
		let best;
		for (const [alias, route] of this.routes) {
			if (!isContained(alias, absolute)) continue;
			if (best === void 0 || alias.length > normalizeLocal(best.aliasPath).length) best = route;
		}
		return best;
	}
	findRemotePath(path) {
		if (!posix.isAbsolute(path) || /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\")) return void 0;
		const normalized = posix.normalize(path);
		let best;
		let bestLength = -1;
		for (const route of this.routeByWorkspaceId.values()) {
			const root = posix.normalize(route.workspace.remotePath);
			const rel = posix.relative(root, normalized);
			if (rel !== "" && (rel === ".." || rel.startsWith("../") || posix.isAbsolute(rel))) continue;
			if (root.length > bestLength) {
				best = route;
				bestLength = root.length;
			} else if (root.length === bestLength && best?.workspace.id !== route.workspace.id) throw new Error(`dsh-ssh-control: remote path matches multiple workspaces: ${path}`);
		}
		return best;
	}
	wasRemoteAlias(path) {
		const absolute = normalizeLocal(resolve(path));
		return [...this.remoteAliases].some((alias) => isContained(alias, absolute));
	}
	async createWorkspaceContext(route) {
		const host = await this.hostContext(route.server);
		const child = new Context();
		try {
			child.provide("remoteSsh", host.remote);
			await child.plugin(RemoteSshFileSystem, {
				remoteWorkspace: route.workspace.remotePath,
				localWorkspace: route.aliasPath
			});
			return {
				ctx: child,
				fs: child.fs,
				remote: host.remote
			};
		} catch (error) {
			await child.fiber.dispose().catch(() => {});
			throw error;
		}
	}
	async hostContext(server) {
		let pending = this.hosts.get(server.id);
		if (pending === void 0) {
			pending = this.createHostContext(server);
			this.hosts.set(server.id, pending);
			pending.catch(() => {
				if (this.hosts.get(server.id) === pending) this.hosts.delete(server.id);
			});
		}
		return pending;
	}
	async createWorkspaceShellContext(route, dialect) {
		const host = await this.hostContext(route.server);
		const child = new Context();
		try {
			child.provide("remoteSsh", host.remote);
			await child.plugin(RemoteSshShellExecutor, {
				localWorkspace: route.aliasPath,
				remoteWorkspace: route.workspace.remotePath,
				shellCommand: dialect
			});
			return {
				ctx: child,
				shell: child.shell,
				remote: host.remote
			};
		} catch (error) {
			await child.fiber.dispose().catch(() => {});
			throw error;
		}
	}
	async createHostContext(server) {
		const child = new Context();
		const transport = this.transportFor(server);
		try {
			await child.plugin(RemoteSshRuntime, {
				sshTarget: server.sshTarget,
				sshExecutable: transport.executable,
				sshArgs: transport.args,
				remoteCodeCommand: server.remoteCodeCommand ?? "code",
				remoteAccessRoot: "/",
				startupTimeoutMs: this.current.startupTimeoutMs,
				requestTimeoutMs: this.current.requestTimeoutMs
			});
			return {
				ctx: child,
				remote: child.remoteSsh,
				key: serverRuntimeKey(server),
				server,
				transport
			};
		} catch (error) {
			await child.fiber.dispose().catch(() => {});
			throw error;
		}
	}
	transportFor(server) {
		let executable = server.sshExecutable ?? "ssh";
		let multiplexed = process.platform !== "win32";
		if (process.platform === "win32") multiplexed = false;
		const args = [...server.sshArgs ?? []];
		if (multiplexed) {
			const digest = createHash("sha256").update(`${process.pid}:${serverRuntimeKey(server)}`).digest("hex").slice(0, 16);
			const controlPath = resolve(tmpdir(), "dsh-ssh", digest).replaceAll("\\", "/");
			args.push("-o", "ControlMaster=auto", "-o", "ControlPersist=60", "-o", `ControlPath=${controlPath}`);
		}
		return {
			executable,
			args,
			multiplexed
		};
	}
	async disposeHost(host) {
		await host.ctx.fiber.dispose();
		if (!host.transport.multiplexed) return;
		await closeControlMaster(host.transport, host.server.sshTarget);
	}
	async replaceSettings(next) {
		if (this.settings === void 0) throw new Error("dsh-ssh-control: settings service is unavailable");
		await this.settings.replace(next);
		await this.refreshTail;
	}
	validate(config) {
		if (!isAbsolute(config.aliasRoot)) throw new Error("dsh-ssh-control: aliasRoot must be an absolute local path");
		if (config.sshConfigFile !== void 0 && !isAbsolute(config.sshConfigFile)) throw new Error("dsh-ssh-control: sshConfigFile must be an absolute path");
		if (config.openFileEditorPath !== void 0 && !isAbsolute(config.openFileEditorPath)) throw new Error("dsh-ssh-control: openFileEditorPath must be an absolute path");
		if (config.openFileMode === "custom" && config.openFileEditorPath === void 0) throw new Error("dsh-ssh-control: custom openFileMode requires openFileEditorPath");
		if (!Number.isSafeInteger(config.openFileDownloadMaxBytes) || config.openFileDownloadMaxBytes <= 0) throw new Error("dsh-ssh-control: openFileDownloadMaxBytes must be a positive integer");
		if (!Number.isSafeInteger(config.startupTimeoutMs) || config.startupTimeoutMs <= 0) throw new Error("dsh-ssh-control: startupTimeoutMs must be a positive integer");
		if (!Number.isSafeInteger(config.requestTimeoutMs) || config.requestTimeoutMs <= 0) throw new Error("dsh-ssh-control: requestTimeoutMs must be a positive integer");
		if (config.defaultServerId !== void 0 && config.defaultServerId.trim().length === 0) delete config.defaultServerId;
		const serverIds = /* @__PURE__ */ new Set();
		for (const server of config.servers) {
			if (!ID_PATTERN.test(server.id) || serverIds.has(server.id)) throw new Error(`dsh-ssh-control: invalid or duplicate server id '${server.id}'`);
			if (server.label.trim().length === 0 || server.sshTarget.trim().length === 0) throw new Error(`dsh-ssh-control: server '${server.id}' requires label and sshTarget`);
			if (server.sshExecutable !== void 0 && server.sshExecutable.trim().length === 0) throw new Error(`dsh-ssh-control: server '${server.id}' sshExecutable must be non-empty`);
			if (server.backendPort !== void 0 && (!Number.isSafeInteger(server.backendPort) || server.backendPort < 0 || server.backendPort > 65535)) throw new Error(`dsh-ssh-control: server '${server.id}' backendPort must be between 0 and 65535`);
			serverIds.add(server.id);
		}
		const workspaceIds = /* @__PURE__ */ new Set();
		const aliases = /* @__PURE__ */ new Set();
		for (const workspace of config.workspaces) {
			if (!ID_PATTERN.test(workspace.id) || workspaceIds.has(workspace.id)) throw new Error(`dsh-ssh-control: invalid or duplicate workspace id '${workspace.id}'`);
			if (!serverIds.has(workspace.serverId)) throw new Error(`dsh-ssh-control: workspace '${workspace.id}' refers to unknown server '${workspace.serverId}'`);
			if (!posix.isAbsolute(workspace.remotePath)) throw new Error(`dsh-ssh-control: workspace '${workspace.id}' remotePath must be an absolute POSIX path`);
			if (workspace.title !== void 0 && workspace.title.trim().length === 0) throw new Error(`dsh-ssh-control: workspace '${workspace.id}' title must be non-empty`);
			const alias = normalizeLocal(resolve(workspace.aliasPath ?? resolve(config.aliasRoot, workspace.id)));
			if (aliases.has(alias)) throw new Error(`dsh-ssh-control: duplicate workspace alias '${alias}'`);
			aliases.add(alias);
			workspaceIds.add(workspace.id);
		}
	}
};
function serverRuntimeKey(server) {
	return JSON.stringify([
		server.sshTarget,
		server.sshArgs ?? [],
		server.remoteCodeCommand ?? "code",
		server.sshExecutable ?? null,
		server.backendPort ?? DEFAULT_DSH_BACKEND_PORT
	]);
}
function backendRuntimeKey(server) {
	return JSON.stringify([server.id, serverRuntimeKey(server)]);
}
function webBackendRuntimeKey(server, localUiPort) {
	return JSON.stringify([
		server.id,
		serverRuntimeKey(server),
		localUiPort
	]);
}
function routeRuntimeKey(route) {
	return JSON.stringify([
		serverRuntimeKey(route.server),
		route.workspace.remotePath,
		normalizeLocal(route.aliasPath)
	]);
}
async function closeControlMaster(transport, target) {
	await new Promise((resolvePromise) => {
		const child = spawn(transport.executable, [
			...transport.args,
			"-O",
			"exit",
			target
		], {
			windowsHide: true,
			stdio: "ignore"
		});
		const timer = setTimeout(() => {
			child.kill();
			resolvePromise();
		}, 3e3);
		child.once("error", () => {
			clearTimeout(timer);
			resolvePromise();
		});
		child.once("close", () => {
			clearTimeout(timer);
			resolvePromise();
		});
	});
}
function normalizeLocal(path) {
	return process.platform === "win32" ? path.toLowerCase() : path;
}
function isContained(parent, child) {
	const rel = relative(parent, child);
	return rel === "" || rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
//#endregion
export { RemoteSshManager, RemoteSshManager as default };
