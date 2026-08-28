import { isAbsolute, resolve } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { spawn } from "node:child_process";
import { promises } from "node:fs";
//#region src/ssh/runner.ts
/** Active background SSH port-forwarding tunnels */
const activeTunnels = /* @__PURE__ */ new Map();
/** Decode buffer with intelligent multi-encoding fallback (UTF-8 -> GBK/GB18030 -> utf8 lenient) */
function decodeOutputBuffer(buf) {
	if (buf.length === 0) return "";
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(buf);
	} catch {
		try {
			return new TextDecoder("gbk").decode(buf);
		} catch {
			return buf.toString("utf8");
		}
	}
}
function quotePosix(value) {
	if (value.includes("\0")) throw new Error("command arguments cannot contain NUL bytes");
	return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
/** Execute a remote command via OpenSSH with encoding self-heal and dialect wrapping */
async function runRemoteSshCommand(target, command, opts) {
	const timeoutMs = opts?.timeoutMs ?? 6e4;
	const workdir = opts?.workdir?.trim();
	let wrappedCommand;
	if (workdir) {
		if (opts?.isWindows) wrappedCommand = `powershell -NoProfile -Command "Set-Location -LiteralPath '${workdir.replace(/'/g, "''")}'; ${command}"`;
		else wrappedCommand = `(cd ${quotePosix(workdir)} 2>/dev/null || cd ~) && ${command}`;
	} else wrappedCommand = command;
	const args = [
		...opts?.sshArgs ?? [],
		"-o",
		"BatchMode=yes",
		target,
		wrappedCommand
	];
	const startTime = Date.now();
	return new Promise((resolve) => {
		let child;
		try {
			child = spawn("ssh", args, { stdio: [
				opts?.stdin !== void 0 ? "pipe" : "ignore",
				"pipe",
				"pipe"
			] });
		} catch (err) {
			return resolve({
				exitCode: -1,
				stdout: "",
				stderr: err?.message || String(err),
				timedOut: false,
				durationMs: Date.now() - startTime
			});
		}
		const stdoutChunks = [];
		const stderrChunks = [];
		let timedOut = false;
		let timer;
		if (timeoutMs > 0) timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
		}, timeoutMs);
		if (opts?.stdin !== void 0 && child.stdin) child.stdin.end(opts.stdin);
		child.stdout?.on("data", (chunk) => {
			stdoutChunks.push(chunk);
		});
		child.stderr?.on("data", (chunk) => {
			stderrChunks.push(chunk);
		});
		child.on("close", (code) => {
			if (timer !== void 0) clearTimeout(timer);
			resolve({
				exitCode: code,
				stdout: decodeOutputBuffer(Buffer.concat(stdoutChunks)).trimEnd(),
				stderr: decodeOutputBuffer(Buffer.concat(stderrChunks)).trimEnd(),
				timedOut,
				durationMs: Date.now() - startTime
			});
		});
		child.on("error", (err) => {
			if (timer !== void 0) clearTimeout(timer);
			const stderr = decodeOutputBuffer(Buffer.concat(stderrChunks)).trimEnd();
			resolve({
				exitCode: -1,
				stdout: decodeOutputBuffer(Buffer.concat(stdoutChunks)).trimEnd(),
				stderr: (stderr ? stderr + "\n" : "") + (err?.message || String(err)),
				timedOut,
				durationMs: Date.now() - startTime
			});
		});
	});
}
/** Read a remote file with line bounding */
async function readRemoteFile(target, filePath, opts) {
	const offset = opts?.offset ?? 1;
	const limit = opts?.limit ?? 2e3;
	let cmd;
	if (opts?.isWindows) cmd = `powershell -NoProfile -Command "Get-Content -LiteralPath '${filePath.replace(/'/g, "''")}' | Select-Object -Skip ${offset - 1} -First ${limit}"`;
	else cmd = `sed -n '${offset},${offset + limit - 1}p' -- ${quotePosix(filePath)}`;
	const res = await runRemoteSshCommand(target, cmd, {
		...opts?.sshArgs ? { sshArgs: opts.sshArgs } : {},
		isWindows: opts?.isWindows
	});
	if (res.exitCode !== 0) throw new Error(res.stderr || `Failed to read ${filePath} (exit ${res.exitCode})`);
	const lines = res.stdout ? res.stdout.split("\n").length : 0;
	return {
		content: res.stdout,
		lines
	};
}
/** Write remote file content via stdin stream (zero-escape loss) */
async function writeRemoteFile(target, filePath, content, opts) {
	let cmd;
	if (opts?.isWindows) cmd = `powershell -NoProfile -Command "$dir = Split-Path -Parent '${filePath.replace(/'/g, "''")}'; if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }; [Console]::Input.ReadToEnd() | Out-File -FilePath '${filePath.replace(/'/g, "''")}' -Encoding utf8"`;
	else cmd = `mkdir -p -- "$(dirname -- ${quotePosix(filePath)})" && cat > ${quotePosix(filePath)}`;
	const res = await runRemoteSshCommand(target, cmd, {
		stdin: content,
		...opts?.sshArgs ? { sshArgs: opts.sshArgs } : {},
		isWindows: opts?.isWindows
	});
	if (res.exitCode !== 0) throw new Error(res.stderr || `Failed to write ${filePath} (exit ${res.exitCode})`);
	return {
		bytes: Buffer.byteLength(content, "utf8"),
		path: filePath
	};
}
/** Upload local file or directory to remote host via OpenSSH SCP stream */
async function uploadViaScp(target, localPath, remotePath, opts) {
	const timeoutMs = opts?.timeoutMs ?? 18e4;
	const absLocalPath = isAbsolute(localPath) ? localPath : resolve(process.cwd(), localPath);
	let isDirectory = false;
	let totalBytes = 0;
	try {
		const stat = await promises.stat(absLocalPath);
		isDirectory = stat.isDirectory();
		totalBytes = stat.size;
	} catch (err) {
		throw new Error(`upload: local file not accessible: ${absLocalPath} (${err.message})`);
	}
	const shouldRecursive = opts?.recursive ?? isDirectory;
	const scpArgs = [
		...opts?.sshArgs ?? [],
		"-o",
		"BatchMode=yes",
		...shouldRecursive ? ["-r"] : [],
		absLocalPath,
		`${target}:${remotePath}`
	];
	const startTime = Date.now();
	return new Promise((resolve, reject) => {
		let child;
		try {
			child = spawn("scp", scpArgs, { stdio: [
				"ignore",
				"pipe",
				"pipe"
			] });
		} catch (err) {
			return reject(/* @__PURE__ */ new Error(`upload failed to spawn scp: ${err.message}`));
		}
		let stderrChunks = [];
		let timer;
		if (timeoutMs > 0) timer = setTimeout(() => {
			child.kill("SIGTERM");
			reject(/* @__PURE__ */ new Error(`upload timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		child.stderr?.on("data", (d) => stderrChunks.push(d));
		child.on("close", (code) => {
			if (timer !== void 0) clearTimeout(timer);
			if (code === 0) resolve({
				bytes: totalBytes,
				durationMs: Date.now() - startTime,
				source: absLocalPath,
				target: `${target}:${remotePath}`
			});
			else {
				const stderr = decodeOutputBuffer(Buffer.concat(stderrChunks));
				reject(new Error(stderr || `upload failed with exit code ${code}`));
			}
		});
		child.on("error", (err) => {
			if (timer !== void 0) clearTimeout(timer);
			reject(err);
		});
	});
}
/** Download remote file or directory to local host via OpenSSH SCP stream */
async function downloadViaScp(target, remotePath, localPath, opts) {
	const timeoutMs = opts?.timeoutMs ?? 18e4;
	const absLocalPath = isAbsolute(localPath) ? localPath : resolve(process.cwd(), localPath);
	try {
		const parentDir = resolve(absLocalPath, "..");
		await promises.mkdir(parentDir, { recursive: true });
	} catch {}
	const scpArgs = [
		...opts?.sshArgs ?? [],
		"-o",
		"BatchMode=yes",
		...opts?.recursive ? ["-r"] : [],
		`${target}:${remotePath}`,
		absLocalPath
	];
	const startTime = Date.now();
	return new Promise((resolve, reject) => {
		let child;
		try {
			child = spawn("scp", scpArgs, { stdio: [
				"ignore",
				"pipe",
				"pipe"
			] });
		} catch (err) {
			return reject(/* @__PURE__ */ new Error(`download failed to spawn scp: ${err.message}`));
		}
		let stderrChunks = [];
		let timer;
		if (timeoutMs > 0) timer = setTimeout(() => {
			child.kill("SIGTERM");
			reject(/* @__PURE__ */ new Error(`download timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		child.stderr?.on("data", (d) => stderrChunks.push(d));
		child.on("close", async (code) => {
			if (timer !== void 0) clearTimeout(timer);
			if (code === 0) {
				let bytes = 0;
				try {
					bytes = (await promises.stat(absLocalPath)).size;
				} catch {}
				resolve({
					durationMs: Date.now() - startTime,
					source: `${target}:${remotePath}`,
					target: absLocalPath,
					bytes
				});
			} else {
				const stderr = decodeOutputBuffer(Buffer.concat(stderrChunks));
				reject(new Error(stderr || `download failed with exit code ${code}`));
			}
		});
		child.on("error", (err) => {
			if (timer !== void 0) clearTimeout(timer);
			reject(err);
		});
	});
}
/** Tail remote logs with optional keyword/error filter */
async function tailRemoteFile(target, filePath, opts) {
	const lineCount = opts?.lines ?? 50;
	let cmd;
	if (opts?.isWindows) {
		const filter = opts?.pattern ? ` | Select-String -Pattern '${opts.pattern.replace(/'/g, "''")}'` : "";
		cmd = `powershell -NoProfile -Command "Get-Content -Tail ${lineCount} -LiteralPath '${filePath.replace(/'/g, "''")}'${filter}"`;
	} else {
		const filter = opts?.pattern ? ` | grep -E -i ${quotePosix(opts.pattern)}` : "";
		cmd = `tail -n ${lineCount} -- ${quotePosix(filePath)}${filter}`;
	}
	const res = await runRemoteSshCommand(target, cmd, { isWindows: opts?.isWindows });
	if (res.exitCode !== 0 && res.stderr && !res.stdout) throw new Error(res.stderr || `Failed to tail ${filePath} (exit ${res.exitCode})`);
	const outputLines = res.stdout ? res.stdout.split("\n") : [];
	return {
		lines: outputLines,
		count: outputLines.length,
		server: target,
		path: filePath
	};
}
/** Parse Linux df -h output into structured disks array */
function parseDiskUsage(dfOutput) {
	const lines = dfOutput.split("\n").map((l) => l.trim()).filter(Boolean);
	if (lines.length <= 1) return [];
	const results = [];
	for (let i = 1; i < lines.length; i++) {
		const parts = lines[i].split(/\s+/);
		if (parts.length >= 6) results.push({
			filesystem: parts[0] ?? "",
			size: parts[1] ?? "",
			used: parts[2] ?? "",
			available: parts[3] ?? "",
			percent: parts[4] ?? "",
			mount: parts.slice(5).join(" ")
		});
	}
	return results;
}
/** Parse docker ps json or formatted list into structured container records */
function parseDockerList(output) {
	const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
	const containers = [];
	for (const line of lines) try {
		const obj = JSON.parse(line);
		containers.push({
			id: obj.ID ?? obj.Id ?? "",
			names: obj.Names ?? obj.Name ?? "",
			image: obj.Image ?? "",
			status: obj.Status ?? "",
			state: obj.State ?? "",
			ports: obj.Ports ?? "",
			created: obj.CreatedAt ?? obj.Created ?? ""
		});
	} catch {}
	return containers;
}
/** Start a background SSH port forwarding tunnel (localPort -> targetHost:targetPort) */
async function startTunnel(server, localPort, targetPort, targetHost = "127.0.0.1", sshArgs) {
	const tunnelId = `${server}-${localPort}-${targetPort}`;
	const existing = activeTunnels.get(tunnelId);
	if (existing) return existing.info;
	const args = [
		...sshArgs ?? [],
		"-o",
		"BatchMode=yes",
		"-N",
		"-L",
		`${localPort}:${targetHost}:${targetPort}`,
		server
	];
	return new Promise((resolve, reject) => {
		let child;
		try {
			child = spawn("ssh", args, { stdio: [
				"ignore",
				"pipe",
				"pipe"
			] });
		} catch (err) {
			return reject(/* @__PURE__ */ new Error(`Failed to spawn tunnel: ${err.message}`));
		}
		let stderr = "";
		child.stderr?.on("data", (d) => stderr += d.toString());
		const info = {
			id: tunnelId,
			server,
			localPort,
			targetHost,
			targetPort,
			pid: child.pid,
			startedAt: Date.now()
		};
		activeTunnels.set(tunnelId, {
			info,
			child
		});
		setTimeout(() => {
			if (child.exitCode !== null) {
				activeTunnels.delete(tunnelId);
				reject(new Error(stderr || `Tunnel exited immediately with code ${child.exitCode}`));
			} else resolve(info);
		}, 800);
		child.on("close", () => {
			activeTunnels.delete(tunnelId);
		});
	});
}
/** Stop a running SSH tunnel */
function stopTunnel(tunnelId) {
	const entry = activeTunnels.get(tunnelId);
	if (entry) {
		try {
			entry.child.kill("SIGTERM");
		} catch {}
		activeTunnels.delete(tunnelId);
		return true;
	}
	return false;
}
/** List all active tunnels */
function listActiveTunnels() {
	return Array.from(activeTunnels.values()).map((v) => v.info);
}
//#endregion
//#region src/routing/control-tool.ts
const name = "dsh-ssh-control-control-tool";
const inject = ["remoteSshManager", "tools"];
function cleanJson(value) {
	return JSON.parse(JSON.stringify(value, (_key, val) => val === void 0 ? null : val));
}
function parseTargetServers(input) {
	if (!input) return [];
	return input.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
}
function apply(ctx) {
	const manager = ctx.remoteSshManager;
	ctx.tools.register(defineTool({
		name: "ssh_control",
		description: "Unified SSH control center: execute remote commands (exec), read/write/upload/download files (read/write/upload/download), dynamic logs (tail), container inspection (docker), server metrics & disk watermarks (status), port tunnels (tunnel/forward), and session attach/detach. Supports single host or batch multi-host execution.",
		parameters: {
			action: {
				type: "string",
				enum: [
					"exec",
					"read",
					"write",
					"upload",
					"download",
					"tail",
					"docker",
					"status",
					"tunnel",
					"list",
					"attach",
					"detach",
					"forward"
				],
				description: "Operation to perform: exec (run shell command/script), read (read lines), write (write stream), upload (transfer local file/dir to remote), download (transfer remote file/dir to local), tail (read latest log & grep errors), docker (list containers/inspect status), status (probe OS/uptime/memory/disk watermarks), tunnel (manage SSH port forwarding), list (discover SSH hosts), attach (bind default server), detach (unbind session), forward (port forward info)."
			},
			server: {
				type: "string",
				description: "Target server ID, OpenSSH host alias (e.g. \"nas-server\"), SSH target, or multiple hosts separated by commas (e.g. \"nas-server, app-node, web-cluster\"). Defaults to active attached server if omitted."
			},
			command: {
				type: "string",
				description: "Shell command to execute on the remote host(s) (used with action: \"exec\")."
			},
			path: {
				type: "string",
				description: "Remote file or directory path (used with read, write, tail, upload, download, exec, attach)."
			},
			localPath: {
				type: "string",
				description: "Local file or directory path on dev machine (used with action: \"upload\" and \"download\")."
			},
			remotePath: {
				type: "string",
				description: "Remote file or directory path on target machine (used with action: \"upload\" and \"download\"). Defaults to path if omitted."
			},
			content: {
				type: "string",
				description: "File content to write (used with action: \"write\")."
			},
			offset: {
				type: "number",
				description: "1-based line offset for reading file (used with action: \"read\")."
			},
			limit: {
				type: "number",
				description: "Maximum lines to read (used with action: \"read\"). Defaults to 2000."
			},
			lines: {
				type: "number",
				description: "Number of lines to tail from end of file (used with action: \"tail\"). Defaults to 50."
			},
			pattern: {
				type: "string",
				description: "Filter keyword or regular expression to search/filter lines (used with action: \"tail\")."
			},
			recursive: {
				type: "boolean",
				description: "Whether to transfer directory recursively (used with action: \"upload\" and \"download\"). Defaults to true for directories."
			},
			workdir: {
				type: "string",
				description: "Working directory on remote host (used with action: \"exec\")."
			},
			timeoutMs: {
				type: "number",
				description: "Execution or transfer timeout in milliseconds. Defaults to 60000 (transfer defaults to 180000)."
			},
			port: {
				type: "number",
				description: "Local port number for tunnel or forward action."
			},
			targetPort: {
				type: "number",
				description: "Remote target port number for tunnel or forward action (defaults to port)."
			},
			targetHost: {
				type: "string",
				description: "Target host for port forwarding (defaults to \"127.0.0.1\")."
			},
			tunnelAction: {
				type: "string",
				enum: [
					"start",
					"stop",
					"list"
				],
				description: "Tunnel sub-action: start (open tunnel), stop (close tunnel), list (list active tunnels). Used with action: \"tunnel\"."
			},
			direction: {
				type: "string",
				enum: ["local", "remote"],
				description: "Forward direction: \"local\" (listen on local, forward to remote) or \"remote\" (listen on remote, forward to local)."
			}
		},
		output: {
			schema: { type: "json" },
			render: (_args, value) => {
				if (value === null || typeof value !== "object") return [{
					type: "text",
					text: String(value)
				}];
				return [{
					type: "text",
					text: JSON.stringify(value, null, 2)
				}];
			}
		},
		async execute(args, exec) {
			const sessionId = exec.agent !== void 0 ? String(exec.agent.session.header.id) : "default";
			const sessionStatus = manager.sessionStatus(sessionId);
			const parsedServers = parseTargetServers(args.server);
			const defaultServer = sessionStatus.server?.sshTarget || sessionStatus.server?.id;
			const servers = parsedServers.length > 0 ? parsedServers : defaultServer ? [defaultServer] : [];
			const isBatch = servers.length > 1;
			const singleServer = servers[0];
			switch (args.action) {
				case "list": {
					const allServers = await manager.listAvailableServers();
					return cleanJson({
						servers: allServers,
						count: allServers.length
					});
				}
				case "exec": {
					if (servers.length === 0) throw new Error("ssh_control exec: no server specified and no active server attached. Provide \"server\" (e.g. \"nas-server\" or \"nas-server, app-node\").");
					if (!args.command) throw new Error("ssh_control exec: \"command\" parameter is required.");
					if (isBatch) {
						const tasks = servers.map(async (srv) => {
							const res = await runRemoteSshCommand(srv, args.command, {
								workdir: args.workdir || args.path,
								timeoutMs: args.timeoutMs
							});
							return {
								server: srv,
								exitCode: res.exitCode,
								stdout: res.stdout,
								stderr: res.stderr,
								timedOut: res.timedOut,
								durationMs: res.durationMs
							};
						});
						const results = await Promise.all(tasks);
						return cleanJson({
							mode: "batch",
							command: args.command,
							total: servers.length,
							successful: results.filter((r) => r.exitCode === 0).length,
							failed: results.filter((r) => r.exitCode !== 0).length,
							results
						});
					}
					const res = await runRemoteSshCommand(singleServer, args.command, {
						workdir: args.workdir || args.path,
						timeoutMs: args.timeoutMs
					});
					return cleanJson({
						server: singleServer,
						command: args.command,
						exitCode: res.exitCode,
						stdout: res.stdout,
						stderr: res.stderr,
						timedOut: res.timedOut,
						durationMs: res.durationMs
					});
				}
				case "read": {
					if (servers.length === 0) throw new Error("ssh_control read: no server specified and no active server attached.");
					if (!args.path) throw new Error("ssh_control read: \"path\" parameter is required.");
					if (isBatch) {
						const tasks = servers.map(async (srv) => {
							try {
								const res = await readRemoteFile(srv, args.path, {
									offset: args.offset,
									limit: args.limit
								});
								return {
									server: srv,
									path: args.path,
									lines: res.lines,
									content: res.content
								};
							} catch (err) {
								return {
									server: srv,
									path: args.path,
									error: err?.message || String(err)
								};
							}
						});
						const results = await Promise.all(tasks);
						return cleanJson({
							mode: "batch",
							path: args.path,
							total: servers.length,
							results
						});
					}
					const res = await readRemoteFile(singleServer, args.path, {
						offset: args.offset,
						limit: args.limit
					});
					return cleanJson({
						server: singleServer,
						path: args.path,
						lines: res.lines,
						content: res.content
					});
				}
				case "write": {
					if (servers.length === 0) throw new Error("ssh_control write: no server specified and no active server attached.");
					if (!args.path) throw new Error("ssh_control write: \"path\" parameter is required.");
					if (isBatch) {
						const tasks = servers.map(async (srv) => {
							try {
								const res = await writeRemoteFile(srv, args.path, args.content ?? "");
								return {
									server: srv,
									path: res.path,
									bytes: res.bytes,
									status: "written"
								};
							} catch (err) {
								return {
									server: srv,
									path: args.path,
									error: err?.message || String(err)
								};
							}
						});
						const results = await Promise.all(tasks);
						return cleanJson({
							mode: "batch",
							path: args.path,
							total: servers.length,
							results
						});
					}
					const res = await writeRemoteFile(singleServer, args.path, args.content ?? "");
					return cleanJson({
						server: singleServer,
						path: res.path,
						bytes: res.bytes,
						status: "written"
					});
				}
				case "upload": {
					if (servers.length === 0) throw new Error("ssh_control upload: no server specified. Provide \"server\".");
					if (!args.localPath) throw new Error("ssh_control upload: \"localPath\" parameter is required.");
					const targetRemotePath = args.remotePath || args.path;
					if (!targetRemotePath) throw new Error("ssh_control upload: \"remotePath\" or \"path\" parameter is required.");
					if (isBatch) {
						const tasks = servers.map(async (srv) => {
							try {
								return {
									server: srv,
									success: true,
									...await uploadViaScp(srv, args.localPath, targetRemotePath, {
										recursive: args.recursive,
										timeoutMs: args.timeoutMs
									})
								};
							} catch (err) {
								return {
									server: srv,
									success: false,
									error: err?.message || String(err)
								};
							}
						});
						const results = await Promise.all(tasks);
						return cleanJson({
							mode: "batch",
							action: "upload",
							localPath: args.localPath,
							remotePath: targetRemotePath,
							total: servers.length,
							successful: results.filter((r) => r.success).length,
							failed: results.filter((r) => !r.success).length,
							results
						});
					}
					return cleanJson({
						server: singleServer,
						action: "upload",
						...await uploadViaScp(singleServer, args.localPath, targetRemotePath, {
							recursive: args.recursive,
							timeoutMs: args.timeoutMs
						})
					});
				}
				case "download": {
					if (!singleServer) throw new Error("ssh_control download: no server specified.");
					const targetRemotePath = args.remotePath || args.path;
					if (!targetRemotePath) throw new Error("ssh_control download: \"remotePath\" or \"path\" parameter is required.");
					if (!args.localPath) throw new Error("ssh_control download: \"localPath\" parameter is required.");
					return cleanJson({
						server: singleServer,
						action: "download",
						...await downloadViaScp(singleServer, targetRemotePath, args.localPath, {
							recursive: args.recursive,
							timeoutMs: args.timeoutMs
						})
					});
				}
				case "tail":
					if (!singleServer) throw new Error("ssh_control tail: no server specified.");
					if (!args.path) throw new Error("ssh_control tail: \"path\" parameter is required.");
					return cleanJson(await tailRemoteFile(singleServer, args.path, {
						lines: args.lines,
						pattern: args.pattern
					}));
				case "docker": {
					if (!singleServer) throw new Error("ssh_control docker: no server specified.");
					if (args.command) {
						const cmd = args.command.startsWith("docker ") ? args.command : `docker ${args.command}`;
						const res = await runRemoteSshCommand(singleServer, cmd, { timeoutMs: args.timeoutMs });
						return cleanJson({
							server: singleServer,
							command: cmd,
							exitCode: res.exitCode,
							stdout: res.stdout,
							stderr: res.stderr
						});
					}
					const listRes = await runRemoteSshCommand(singleServer, "docker ps -a --format \"{{json .}}\"", { timeoutMs: 15e3 });
					if (listRes.exitCode === 0) {
						const containers = parseDockerList(listRes.stdout);
						return cleanJson({
							server: singleServer,
							dockerReachable: true,
							totalContainers: containers.length,
							runningContainers: containers.filter((c) => c.state.toLowerCase() === "running" || c.status.toLowerCase().startsWith("up")).length,
							containers
						});
					}
					return cleanJson({
						server: singleServer,
						dockerReachable: false,
						exitCode: listRes.exitCode,
						error: listRes.stderr || listRes.stdout || "docker command failed or not installed"
					});
				}
				case "status":
					if (parsedServers.length > 1) {
						const tasks = parsedServers.map(async (srv) => {
							const probeRes = await runRemoteSshCommand(srv, "hostname && uname -a && uptime && free -h && df -h", { timeoutMs: 12e3 });
							const dfRes = await runRemoteSshCommand(srv, "df -h", { timeoutMs: 8e3 });
							const disks = dfRes.exitCode === 0 ? parseDiskUsage(dfRes.stdout) : [];
							return {
								server: srv,
								reachable: probeRes.exitCode === 0,
								exitCode: probeRes.exitCode,
								output: probeRes.stdout || probeRes.stderr,
								disks,
								durationMs: probeRes.durationMs
							};
						});
						const results = await Promise.all(tasks);
						return cleanJson({
							mode: "batch",
							total: parsedServers.length,
							results
						});
					}
					if (parsedServers.length === 1) {
						const probeTarget = parsedServers[0];
						const probeRes = await runRemoteSshCommand(probeTarget, "hostname && uname -a && uptime && free -h", { timeoutMs: 1e4 });
						const dfRes = await runRemoteSshCommand(probeTarget, "df -h", { timeoutMs: 8e3 });
						const disks = dfRes.exitCode === 0 ? parseDiskUsage(dfRes.stdout) : [];
						return cleanJson({
							server: probeTarget,
							reachable: probeRes.exitCode === 0,
							exitCode: probeRes.exitCode,
							output: probeRes.stdout || probeRes.stderr,
							disks,
							durationMs: probeRes.durationMs
						});
					}
					return cleanJson(sessionStatus);
				case "tunnel": {
					const subAction = args.tunnelAction ?? "list";
					if (subAction === "list") {
						const list = listActiveTunnels();
						return cleanJson({
							count: list.length,
							tunnels: list
						});
					}
					if (subAction === "stop") {
						const targetId = args.server ? `${args.server}-${args.port}-${args.targetPort ?? args.port}` : String(args.port);
						return cleanJson({
							status: stopTunnel(targetId) ? "stopped" : "not_found",
							tunnelId: targetId
						});
					}
					if (subAction === "start") {
						if (!singleServer) throw new Error("ssh_control tunnel start: \"server\" parameter is required.");
						if (!args.port) throw new Error("ssh_control tunnel start: \"port\" parameter is required.");
						const targetP = args.targetPort ?? args.port;
						const tHost = args.targetHost ?? "127.0.0.1";
						return cleanJson({
							status: "active",
							...await startTunnel(singleServer, args.port, targetP, tHost)
						});
					}
					throw new Error(`ssh_control tunnel: unknown tunnelAction '${subAction}'`);
				}
				case "attach": return cleanJson(await manager.attachSession(sessionId, {
					...args.server !== void 0 ? { server: args.server } : {},
					...args.path !== void 0 ? { path: args.path } : {}
				}));
				case "detach": return cleanJson(await manager.detachSession(sessionId));
				case "forward": return cleanJson({
					status: "forward_info",
					message: "Port forwarding via SSH connection is managed automatically by the active host tunnel.",
					port: args.port ?? 0,
					targetPort: args.targetPort ?? args.port ?? 0,
					direction: args.direction ?? "local"
				});
				default: throw new Error(`dsh-ssh-control: unsupported action '${String(args.action)}'`);
			}
		}
	}));
}
//#endregion
export { apply, inject, name };
