window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-ssh-control",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/locales.ts
		/** English copy for SSH Control Center settings and flows. */
		const en = {
			nav: "SSH Control",
			pluginSummary: "Unified SSH control center with stateless multi-host dispatch and direct pipes.",
			sshConfigLabel: "Custom SSH config file",
			sshConfigPlaceholder: "Leave blank to use the user and system defaults (~/.ssh/config)",
			sshConfigHelp: "When set, hosts are discovered only from this file and its Includes.",
			absolutePathRequired: "Enter an absolute file path.",
			saveFailed: "Could not save. Check the path and permissions.",
			discard: "Discard",
			save: "Save",
			saving: "Saving…",
			openFileLabel: "Open remote files with",
			openFileAuto: "Auto-detect VSC editor (recommended)",
			openFileVscode: "Visual Studio Code",
			openFileCursor: "Cursor",
			openFileWindsurf: "Windsurf",
			openFileVscodium: "VSCodium",
			openFileCustom: "Custom VSC-compatible editor",
			openFileDownload: "Always download and open locally",
			openFileHelp: "If no compatible editor is available, the file is downloaded and opened locally.",
			customEditorLabel: "Editor executable",
			customEditorPlaceholder: "Absolute path to the editor executable",
			directoryPath: "{title} path",
			go: "Go",
			home: "Home",
			parent: "Up",
			directoryLoading: "Loading directory…",
			directoryEmpty: "This directory has no subdirectories.",
			cancel: "Cancel",
			selectCurrentFolder: "Select current folder",
			title: "SSH Control Center",
			summary: "Discovered {servers} SSH hosts. Supports stateless direct dispatch and batch execution.",
			servers: "Discovered SSH Hosts",
			savedServer: "OpenSSH Config Entry",
			test: "Probe Status",
			probing: "Probing…",
			openBackend: "Open Terminal",
			backendOpened: "Terminal opened.",
			popupBlocked: "Allow pop-ups to open the window.",
			backendConnecting: "Connecting Host…",
			backendReconnecting: "Reconnecting Host…",
			backendChecking: "Checking Host…",
			backendWaiting: "Waiting for another Host update…",
			backendUploading: "Uploading Host…",
			backendReusing: "Reusing Host…",
			backendInstallingNode: "Installing Node.js…",
			backendInstallingPnpm: "Installing pnpm…",
			backendInstallingHarness: "Installing DeepSeek Harness…",
			backendVerifyingRuntime: "Verifying runtime…",
			backendInstallingBundle: "Installing bundle…",
			backendStarting: "Starting…",
			backendReady: "Ready.",
			noHosts: "No concrete Host entries found in the active SSH configuration (~/.ssh/config).",
			addSshHost: "Add New Host",
			refresh: "Rescan Config",
			sshCommand: "SSH connection command (e.g. ssh user@hostname -p 22)",
			chooseSshConfig: "Choose SSH config file to write",
			customConfigAction: "Specify custom config file",
			add: "Add",
			hostAdded: "The SSH host was written to the config file.",
			configReloaded: "SSH configuration reloaded successfully.",
			customConfigGuidance: "Set an absolute path in Settings > Plugins > SSH Control Center.",
			probeSuccess: "Reachable · Hostname: {hostname} · {commands}",
			probeFailure: "Connection failed: {error}",
			unknownError: "Unknown error",
			remoteWorkspaces: "Session Bindings",
			removeMapping: "Unbind",
			server: "Server",
			remotePath: "Remote path",
			browseRemote: "Browse remote…",
			addWorkspace: "Add Mapping",
			selectRemoteFolder: "Select remote folder",
			tombstoneHelp: "Unbinding does not delete workspace or session logs.",
			addWorkspaceTitle: "Add session mapping",
			chooseLocalFolder: "LOCAL · Choose local folder…",
			selectLocalFolder: "Select local folder",
			selectRemoteSsh: "Select SSH Server",
			remotePathPlaceholder: "Absolute remote path, for example /srv/project",
			copyServer: "Copy Identifier",
			copied: "Copied!",
			quickGuide: "AI Agent Cheatsheet",
			configSection: "OpenSSH Configuration",
			editorSection: "Editor & Local Integration"
		};
		/** Chinese copy for SSH Control Center settings and flows. */
		const zh = {
			nav: "SSH 控制中枢",
			pluginSummary: "统一 SSH 复合控制中枢 · 无状态直连与多机并发",
			sshConfigLabel: "自定义 SSH 配置文件",
			sshConfigPlaceholder: "留空以使用用户和系统默认配置 (~/.ssh/config)",
			sshConfigHelp: "设置后仅从该文件及其 Include 中发现主机。",
			absolutePathRequired: "请输入绝对文件路径。",
			saveFailed: "保存失败，请检查路径和设置写权限。",
			discard: "放弃",
			save: "保存",
			saving: "保存中…",
			openFileLabel: "远端文件打开方式",
			openFileAuto: "自动检测 VSC 编辑器（推荐）",
			openFileVscode: "Visual Studio Code",
			openFileCursor: "Cursor",
			openFileWindsurf: "Windsurf",
			openFileVscodium: "VSCodium",
			openFileCustom: "自定义 VSC 兼容编辑器",
			openFileDownload: "总是下载后在本机打开",
			openFileHelp: "找不到可用编辑器时，将下载文件并在本机打开。",
			customEditorLabel: "编辑器可执行文件",
			customEditorPlaceholder: "编辑器可执行文件的绝对路径",
			directoryPath: "{title}路径",
			go: "转到",
			home: "主目录",
			parent: "上一级",
			directoryLoading: "正在读取目录…",
			directoryEmpty: "此目录没有子目录。",
			cancel: "取消",
			selectCurrentFolder: "选择当前文件夹",
			title: "SSH 控制中枢 (SSH Control Center)",
			summary: "OpenSSH 配置中发现 {servers} 台主机。支持单机无状态直连与多机并发广播控制。",
			servers: "已发现的 SSH 主机",
			savedServer: "OpenSSH 配置文件档案",
			test: "状态探查",
			probing: "正在探查…",
			openBackend: "打开终端",
			backendOpened: "终端已打开。",
			popupBlocked: "请允许弹出窗口以打开窗口。",
			backendConnecting: "正在连接 Host…",
			backendReconnecting: "正在重新连接 Host…",
			backendChecking: "正在检查 Host…",
			backendWaiting: "正在等待另一个 Host 更新…",
			backendUploading: "正在上传 Host…",
			backendReusing: "正在复用…",
			backendInstallingNode: "正在安装 Node.js…",
			backendInstallingPnpm: "正在安装 pnpm…",
			backendInstallingHarness: "正在安装 Harness…",
			backendVerifyingRuntime: "正在验证运行时…",
			backendInstallingBundle: "正在安装 Bundle…",
			backendStarting: "正在启动…",
			backendReady: "就绪。",
			noHosts: "活动 SSH 配置 (~/.ssh/config) 中未扫描到具体的 Host 记录。",
			addSshHost: "添加主机",
			refresh: "重新扫描",
			sshCommand: "SSH 连接命令 (例如 ssh user@hostname -p 22)",
			chooseSshConfig: "选择要写入的 SSH 配置文件",
			customConfigAction: "指定自定义配置文件",
			add: "添加",
			hostAdded: "SSH 主机已成功写入配置文件。",
			configReloaded: "已重新扫描并读取最新 SSH 配置。",
			customConfigGuidance: "请在“设置 > 插件 > SSH 控制中枢”中填写“自定义 SSH 配置文件”绝对路径。",
			probeSuccess: "连通正常 · 机器名: {hostname} · {commands}",
			probeFailure: "连接失败: {error}",
			unknownError: "未知错误",
			remoteWorkspaces: "会话绑定映射",
			removeMapping: "解除绑定",
			server: "服务器",
			remotePath: "远端路径",
			browseRemote: "浏览远端…",
			addWorkspace: "添加映射",
			selectRemoteFolder: "选择远端文件夹",
			tombstoneHelp: "解除绑定不会影响本地文件或会话日志。",
			addWorkspaceTitle: "添加会话映射",
			chooseLocalFolder: "LOCAL · 选择本机文件夹…",
			selectLocalFolder: "选择本机文件夹",
			selectRemoteSsh: "选择 SSH 服务器",
			remotePathPlaceholder: "远端绝对路径，例如 /srv/project",
			copyServer: "复制标识",
			copied: "已复制！",
			quickGuide: "AI 交互使用指南 (Cheatsheet)",
			configSection: "OpenSSH 配置中心",
			editorSection: "编辑器与本地集成"
		};
		//#endregion
		//#region src/client/api.ts
		const STATE_PATH = "/plugins/@dsh-external/dsh-ssh-control/state";
		const PROBE_PATH = "/plugins/@dsh-external/dsh-ssh-control/probe";
		const CONFIG_HOST_PATH = "/plugins/@dsh-external/dsh-ssh-control/ssh-config/host";
		const SETTINGS_PATH = "/plugins/@dsh-external/dsh-ssh-control/settings";
		const emptyCatalog = {
			servers: [],
			workspaces: [],
			serverCount: 0,
			discoveredServerCount: 0,
			workspaceCount: 0,
			configFiles: [],
			loadedConfigFiles: [],
			configErrors: [],
			openFileMode: "auto"
		};
		async function request(path, method = "GET", body) {
			const response = await fetch(path, {
				method,
				credentials: "same-origin",
				headers: {
					accept: "application/json",
					...body === void 0 ? {} : { "content-type": "application/json" }
				},
				...body === void 0 ? {} : { body: JSON.stringify(body) }
			});
			const value = await response.json().catch(() => void 0);
			if (!response.ok) {
				const message = typeof value === "object" && value !== null && "error" in value ? String(value.error) : `HTTP ${response.status}`;
				throw new Error(message);
			}
			return value;
		}
		//#endregion
		//#region src/client/styles.ts
		const page = {
			display: "flex",
			flexDirection: "column",
			gap: 18,
			maxWidth: 760
		};
		const card = {
			display: "flex",
			flexDirection: "column",
			gap: 12,
			padding: 18,
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 12,
			background: "var(--dsw-alias-bg-module-platform)"
		};
		const row = {
			display: "flex",
			gap: 10,
			alignItems: "center",
			flexWrap: "wrap"
		};
		const singleLineInput = {
			minWidth: 180,
			flex: "1 1 180px",
			padding: "8px 10px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 8,
			background: "var(--dsw-alias-bg-layer-1)",
			color: "var(--dsw-alias-label-primary)",
			minWidth: 0,
			width: 520,
			maxWidth: "100%",
			height: 36,
			flex: "0 0 auto",
			boxSizing: "border-box"
		};
		const button = {
			padding: "7px 13px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 18,
			background: "var(--dsw-alias-bg-layer-1)",
			color: "var(--dsw-alias-label-primary)",
			cursor: "pointer"
		};
		const primary = {
			...button,
			borderColor: "var(--dsw-alias-brand-primary)",
			background: "var(--dsw-alias-brand-primary)",
			color: "white"
		};
		const dim = {
			margin: 0,
			color: "var(--dsw-alias-label-secondary)",
			fontSize: 14
		};
		//#endregion
		//#region src/client/types.ts
		function requireTranslate(t, surface) {
			if (t === void 0) throw new Error(`${surface} requires its translation function`);
			return t;
		}
		//#endregion
		//#region src/client/icons.tsx
		const defaultProps = {
			xmlns: "http://www.w3.org/2000/svg",
			width: 16,
			height: 16,
			viewBox: "0 0 24 24",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 2,
			strokeLinecap: "round",
			strokeLinejoin: "round"
		};
		function ServerIcon({ size = 16, color, style, ...props }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				...defaultProps,
				width: size,
				height: size,
				style: {
					color,
					flexShrink: 0,
					...style
				},
				...props,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						width: "20",
						height: "8",
						x: "2",
						y: "2",
						rx: "2",
						ry: "2"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						width: "20",
						height: "8",
						x: "2",
						y: "14",
						rx: "2",
						ry: "2"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
						x1: "6",
						x2: "6.01",
						y1: "6",
						y2: "6"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
						x1: "6",
						x2: "6.01",
						y1: "18",
						y2: "18"
					})
				]
			});
		}
		function RefreshIcon({ size = 16, color, style, ...props }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				...defaultProps,
				width: size,
				height: size,
				style: {
					color,
					flexShrink: 0,
					...style
				},
				...props,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M21 3v5h-5" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M8 16H3v5" })
				]
			});
		}
		function PlusIcon({ size = 16, color, style, ...props }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				...defaultProps,
				width: size,
				height: size,
				style: {
					color,
					flexShrink: 0,
					...style
				},
				...props,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
					x1: "12",
					y1: "5",
					x2: "12",
					y2: "19"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
					x1: "5",
					y1: "12",
					x2: "19",
					y2: "12"
				})]
			});
		}
		function CopyIcon({ size = 16, color, style, ...props }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				...defaultProps,
				width: size,
				height: size,
				style: {
					color,
					flexShrink: 0,
					...style
				},
				...props,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
					width: "14",
					height: "14",
					x: "8",
					y: "8",
					rx: "2",
					ry: "2"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" })]
			});
		}
		function CheckIcon({ size = 16, color, style, ...props }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				...defaultProps,
				width: size,
				height: size,
				style: {
					color,
					flexShrink: 0,
					...style
				},
				...props,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("polyline", { points: "20 6 9 17 4 12" })
			});
		}
		function ActivityIcon({ size = 16, color, style, ...props }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				...defaultProps,
				width: size,
				height: size,
				style: {
					color,
					flexShrink: 0,
					...style
				},
				...props,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M22 12h-4l-3 9L9 3l-3 9H2" })
			});
		}
		function SettingsIcon({ size = 16, color, style, ...props }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				...defaultProps,
				width: size,
				height: size,
				style: {
					color,
					flexShrink: 0,
					...style
				},
				...props,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "12",
					cy: "12",
					r: "3"
				})]
			});
		}
		function TerminalIcon({ size = 16, color, style, ...props }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				...defaultProps,
				width: size,
				height: size,
				style: {
					color,
					flexShrink: 0,
					...style
				},
				...props,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("polyline", { points: "4 17 10 11 4 5" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
					x1: "12",
					y1: "19",
					x2: "20",
					y2: "19"
				})]
			});
		}
		function CodeIcon({ size = 16, color, style, ...props }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				...defaultProps,
				width: size,
				height: size,
				style: {
					color,
					flexShrink: 0,
					...style
				},
				...props,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("polyline", { points: "16 18 22 12 16 6" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("polyline", { points: "8 6 2 12 8 18" })]
			});
		}
		function AlertCircleIcon({ size = 16, color, style, ...props }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				...defaultProps,
				width: size,
				height: size,
				style: {
					color,
					flexShrink: 0,
					...style
				},
				...props,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "12",
						cy: "12",
						r: "10"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
						x1: "12",
						y1: "8",
						x2: "12",
						y2: "12"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
						x1: "12",
						y1: "16",
						x2: "12.01",
						y2: "16"
					})
				]
			});
		}
		//#endregion
		//#region src/client/RemoteSshPluginCard.tsx
		/** Settings > Plugins card for SSH discovery configuration. */
		function RemoteSshPluginCard({ t: optionalT }) {
			const t = requireTranslate(optionalT, "SSH Control plugin settings");
			const [current, setCurrent] = (0, react.useState)("");
			const [draft, setDraft] = (0, react.useState)("");
			const [open, setOpen] = (0, react.useState)(false);
			const [saving, setSaving] = (0, react.useState)(false);
			const [loading, setLoading] = (0, react.useState)(true);
			const [failed, setFailed] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				request(STATE_PATH).then((state) => {
					const value = state.customConfigFile ?? "";
					setCurrent(value);
					setDraft(value);
					setLoading(false);
				}, () => {
					setFailed(true);
					setLoading(false);
				});
			}, []);
			const absolute = (value) => /^(?:[A-Za-z]:[\\/]|\/)/.test(value);
			const invalid = draft.trim() !== "" && !absolute(draft.trim());
			const dirty = draft !== current;
			const save = async () => {
				setSaving(true);
				setFailed(false);
				try {
					const value = (await request("/plugins/@dsh-external/dsh-ssh-control/settings", "POST", { sshConfigFile: draft.trim() })).sshConfigFile ?? "";
					setCurrent(value);
					setDraft(value);
				} catch {
					setFailed(true);
				} finally {
					setSaving(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				style: {
					listStyle: "none",
					border: "1px solid var(--dsw-alias-border-l2)",
					borderRadius: 12,
					overflow: "hidden"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					style: {
						...button,
						width: "100%",
						border: 0,
						borderRadius: 0,
						padding: 14,
						textAlign: "left",
						display: "flex",
						alignItems: "center",
						gap: 12
					},
					"aria-expanded": open,
					onClick: () => {
						setOpen((value) => !value);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SettingsIcon, {
						size: 20,
						style: { color: "var(--dsw-alias-brand-primary, #3b82f6)" }
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: { flex: 1 },
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", {
							style: {
								fontSize: 15,
								color: "var(--dsw-alias-label-primary)"
							},
							children: t("title")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								display: "block",
								...dim,
								marginTop: 4
							},
							children: t("pluginSummary")
						})]
					})]
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						padding: 16,
						display: "flex",
						flexDirection: "column",
						gap: 12,
						background: "var(--dsw-alias-bg-layer-1)"
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							htmlFor: "plugin-remote-ssh-config",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: t("sshConfigLabel") })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							id: "plugin-remote-ssh-config",
							style: {
								...singleLineInput,
								width: "100%"
							},
							placeholder: t("sshConfigPlaceholder"),
							value: draft,
							disabled: loading || saving,
							onChange: (event) => {
								setDraft(event.target.value);
								setFailed(false);
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: dim,
							children: t("sshConfigHelp")
						}),
						invalid ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							role: "alert",
							style: dim,
							children: t("absolutePathRequired")
						}) : null,
						failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							role: "alert",
							style: dim,
							children: t("saveFailed")
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								...row,
								justifyContent: "flex-end",
								marginTop: 6
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								style: button,
								disabled: !dirty || saving,
								onClick: () => {
									setDraft(current);
									setFailed(false);
								},
								children: t("discard")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								style: {
									...button,
									background: "var(--dsw-alias-brand-primary, #3b82f6)",
									color: "#ffffff",
									borderColor: "transparent",
									fontWeight: 500,
									padding: "7px 18px"
								},
								disabled: !dirty || invalid || loading || saving,
								onClick: () => {
									save();
								},
								children: saving ? t("saving") : t("save")
							})]
						})
					]
				}) : null]
			});
		}
		//#endregion
		//#region src/client/RemoteSshSettings.tsx
		/** Clean & Pure SSH Control Center settings page. */
		function RemoteSshSettings({ t: optionalT }) {
			const t = requireTranslate(optionalT, "SSH Control Center settings");
			const [state, setState] = (0, react.useState)(emptyCatalog);
			const [showAddHost, setShowAddHost] = (0, react.useState)(false);
			const [hostCommand, setHostCommand] = (0, react.useState)("");
			const [configPath, setConfigPath] = (0, react.useState)("");
			const [customConfigDraft, setCustomConfigDraft] = (0, react.useState)("");
			const [message, setMessage] = (0, react.useState)("");
			const [copyStatus, setCopyStatus] = (0, react.useState)({});
			const [probeResults, setProbeResults] = (0, react.useState)({});
			const [savingSettings, setSavingSettings] = (0, react.useState)(false);
			const [refreshing, setRefreshing] = (0, react.useState)(false);
			const refresh = (0, react.useCallback)(async () => {
				setRefreshing(true);
				try {
					const next = await request(STATE_PATH);
					setState(next);
					setConfigPath((current) => next.configFiles.includes(current) ? current : next.configFiles[0] ?? "");
					setCustomConfigDraft(next.customConfigFile ?? "");
				} catch (error) {
					setMessage(String(error));
				} finally {
					setRefreshing(false);
				}
			}, []);
			(0, react.useEffect)(() => {
				refresh();
			}, [refresh]);
			const addHost = async () => {
				if (!hostCommand.trim()) return;
				await request(CONFIG_HOST_PATH, "POST", {
					command: hostCommand,
					configPath
				});
				setHostCommand("");
				setShowAddHost(false);
				setMessage(t("hostAdded"));
				await refresh();
			};
			const probe = async (id) => {
				setProbeResults((prev) => ({
					...prev,
					[id]: {
						reachable: false,
						loading: true
					}
				}));
				try {
					const result = await request(PROBE_PATH, "POST", { id });
					setProbeResults((prev) => ({
						...prev,
						[id]: {
							...result,
							loading: false
						}
					}));
				} catch (err) {
					setProbeResults((prev) => ({
						...prev,
						[id]: {
							reachable: false,
							error: err?.message || String(err),
							loading: false
						}
					}));
				}
			};
			const copyText = (key, text) => {
				navigator.clipboard.writeText(text);
				setCopyStatus((prev) => ({
					...prev,
					[key]: true
				}));
				setTimeout(() => {
					setCopyStatus((prev) => ({
						...prev,
						[key]: false
					}));
				}, 2e3);
			};
			const saveCustomConfig = async () => {
				setSavingSettings(true);
				try {
					await request(SETTINGS_PATH, "POST", { sshConfigFile: customConfigDraft.trim() });
					setMessage(t("configReloaded"));
					await refresh();
				} catch {
					setMessage(t("saveFailed"));
				} finally {
					setSavingSettings(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: {
					...page,
					maxWidth: 840,
					gap: 20
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							justifyContent: "space-between",
							alignItems: "flex-start",
							flexWrap: "wrap",
							gap: 14
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: 4
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									gap: 10
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TerminalIcon, {
									size: 24,
									style: { color: "var(--dsw-alias-brand-primary, #3b82f6)" }
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
									style: {
										margin: 0,
										fontSize: 22,
										fontWeight: 700,
										letterSpacing: "-0.01em"
									},
									children: t("title")
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: {
									...dim,
									margin: 0,
									fontSize: 13,
									lineHeight: "1.5"
								},
								children: t("summary", { servers: state.discoveredServerCount })
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								gap: 8,
								alignItems: "center"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								style: {
									...button,
									display: "inline-flex",
									alignItems: "center",
									gap: 6,
									fontSize: 13
								},
								disabled: refreshing,
								onClick: () => {
									refresh().then(() => setMessage(t("configReloaded")));
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RefreshIcon, {
									size: 14,
									style: { animation: refreshing ? "spin 1s linear infinite" : "none" }
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("refresh") })]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								style: {
									...button,
									display: "inline-flex",
									alignItems: "center",
									gap: 6,
									fontSize: 13
								},
								onClick: () => setShowAddHost((v) => !v),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PlusIcon, { size: 14 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("addSshHost") })]
							})]
						})]
					}),
					message ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						role: "status",
						style: {
							display: "flex",
							alignItems: "center",
							gap: 10,
							padding: "10px 16px",
							borderRadius: 10,
							background: "var(--dsw-alias-bg-layer-2)",
							border: "1px solid var(--dsw-alias-brand-primary, #3b82f6)"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TerminalIcon, {
							size: 16,
							style: { color: "var(--dsw-alias-brand-primary, #3b82f6)" }
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: {
								...dim,
								margin: 0,
								color: "var(--dsw-alias-label-primary)",
								fontSize: 13
							},
							children: message
						})]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: card,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									display: "flex",
									justifyContent: "space-between",
									alignItems: "center"
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										alignItems: "center",
										gap: 8
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ServerIcon, {
										size: 18,
										style: { color: "var(--dsw-alias-brand-primary, #3b82f6)" }
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", {
										style: { fontSize: 15 },
										children: [
											t("servers"),
											" (",
											state.servers.length,
											")"
										]
									})]
								})
							}),
							state.servers.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: dim,
								children: t("noHosts")
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									display: "grid",
									gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
									gap: 12
								},
								children: state.servers.map((server) => {
									const probeState = probeResults[server.id];
									const isCopied = copyStatus[server.label];
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "flex",
											flexDirection: "column",
											gap: 10,
											padding: 14,
											borderRadius: 10,
											border: "1px solid var(--dsw-alias-border-l2)",
											background: "var(--dsw-alias-bg-layer-1)",
											transition: "border-color 0.2s"
										},
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: {
													display: "flex",
													justifyContent: "space-between",
													alignItems: "center"
												},
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													style: {
														display: "flex",
														alignItems: "center",
														gap: 8
													},
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: {
														width: 8,
														height: 8,
														borderRadius: "50%",
														background: probeState?.reachable ? "#4ade80" : "var(--dsw-alias-label-secondary)",
														boxShadow: probeState?.reachable ? "0 0 8px rgba(74, 222, 128, 0.6)" : "none"
													} }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
														style: {
															fontSize: 15,
															color: "var(--dsw-alias-label-primary)"
														},
														children: server.label
													})]
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													style: {
														fontSize: 11,
														padding: "2px 8px",
														borderRadius: 10,
														fontWeight: 500,
														background: "var(--dsw-alias-bg-layer-2)",
														color: "var(--dsw-alias-label-secondary)",
														border: "1px solid var(--dsw-alias-border-l2)"
													},
													children: server.source === "ssh-config" ? "OpenSSH" : "Settings"
												})]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												style: {
													fontSize: 12,
													fontFamily: "monospace",
													color: "var(--dsw-alias-label-secondary)",
													wordBreak: "break-all",
													background: "var(--dsw-alias-bg-layer-2)",
													padding: "5px 8px",
													borderRadius: 6
												},
												children: server.hostName ? `${server.user ? `${server.user}@` : ""}${server.hostName}${server.port ? `:${server.port}` : ""}` : "SSH Target"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: {
													display: "flex",
													gap: 8
												},
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
													style: {
														...button,
														display: "inline-flex",
														alignItems: "center",
														justifyContent: "center",
														gap: 6,
														fontSize: 12,
														padding: "5px 12px",
														flex: 1
													},
													disabled: probeState?.loading,
													onClick: () => {
														probe(server.id);
													},
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActivityIcon, {
														size: 14,
														style: { color: probeState?.loading ? "var(--dsw-alias-label-secondary)" : "#3b82f6" }
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: probeState?.loading ? t("probing") : t("test") })]
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
													style: {
														...button,
														display: "inline-flex",
														alignItems: "center",
														justifyContent: "center",
														gap: 6,
														fontSize: 12,
														padding: "5px 12px"
													},
													onClick: () => copyText(server.label, server.label),
													children: [isCopied ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckIcon, {
														size: 14,
														style: { color: "#4ade80" }
													}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CopyIcon, { size: 14 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: isCopied ? t("copied") : t("copyServer") })]
												})]
											}),
											probeState && !probeState.loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: {
													display: "flex",
													alignItems: "flex-start",
													gap: 6,
													padding: "8px 10px",
													borderRadius: 6,
													fontSize: 12,
													lineHeight: "1.4",
													background: probeState.reachable ? "rgba(74, 222, 128, 0.08)" : "rgba(239, 68, 68, 0.08)",
													color: probeState.reachable ? "#4ade80" : "#ef4444",
													border: `1px solid ${probeState.reachable ? "rgba(74, 222, 128, 0.25)" : "rgba(239, 68, 68, 0.25)"}`
												},
												children: [probeState.reachable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckIcon, {
													size: 14,
													style: {
														marginTop: 2,
														flexShrink: 0
													}
												}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AlertCircleIcon, {
													size: 14,
													style: {
														marginTop: 2,
														flexShrink: 0
													}
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: probeState.reachable ? t("probeSuccess", {
													hostname: probeState.hostname ?? server.label,
													commands: Object.entries(probeState.commands ?? {}).map(([cmd, ok]) => `${cmd} ${ok ? "✓" : "×"}`).join(", ")
												}) : t("probeFailure", { error: probeState.error ?? t("unknownError") }) })]
											}) : null
										]
									}, server.id);
								})
							}),
							showAddHost ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									...card,
									padding: 16,
									marginTop: 8,
									background: "var(--dsw-alias-bg-layer-2)",
									border: "1px solid var(--dsw-alias-border-l2)"
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
										style: { fontSize: 14 },
										children: t("addSshHost")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										style: {
											...singleLineInput,
											width: "100%"
										},
										"aria-label": t("sshCommand"),
										placeholder: t("sshCommand"),
										value: hostCommand,
										onChange: (e) => setHostCommand(e.target.value)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "flex",
											flexDirection: "column",
											gap: 6
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: {
												fontSize: 13,
												fontWeight: 600
											},
											children: t("chooseSshConfig")
										}), state.configFiles.map((path) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
											style: {
												...row,
												alignItems: "center",
												fontSize: 13
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "radio",
												name: "target-ssh-config",
												checked: configPath === path,
												onChange: () => setConfigPath(path)
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: { fontFamily: "monospace" },
												children: path
											})]
										}, path))]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											...row,
											justifyContent: "flex-end",
											marginTop: 8
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											style: button,
											onClick: () => setShowAddHost(false),
											children: t("cancel")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											style: primary,
											disabled: !hostCommand.trim() || !configPath,
											onClick: () => {
												addHost();
											},
											children: t("add")
										})]
									})
								]
							}) : null
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: card,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									gap: 8
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SettingsIcon, {
									size: 18,
									style: { color: "var(--dsw-alias-brand-primary, #3b82f6)" }
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
									style: { fontSize: 15 },
									children: t("configSection")
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									flexDirection: "column",
									gap: 6
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										htmlFor: "custom-ssh-config-input",
										style: {
											fontSize: 13,
											fontWeight: 600
										},
										children: t("sshConfigLabel")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										id: "custom-ssh-config-input",
										style: {
											...singleLineInput,
											width: "100%"
										},
										placeholder: t("sshConfigPlaceholder"),
										value: customConfigDraft,
										onChange: (e) => setCustomConfigDraft(e.target.value)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										style: dim,
										children: t("sshConfigHelp")
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									...row,
									justifyContent: "flex-end",
									marginTop: 8
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									style: {
										...button,
										background: "var(--dsw-alias-brand-primary, #3b82f6)",
										color: "#ffffff",
										borderColor: "transparent",
										fontWeight: 500,
										padding: "7px 18px"
									},
									disabled: savingSettings,
									onClick: () => {
										saveCustomConfig();
									},
									children: savingSettings ? t("saving") : t("save")
								})
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							...card,
							background: "var(--dsw-alias-bg-layer-2)"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: 8
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CodeIcon, {
								size: 18,
								style: { color: "var(--dsw-alias-brand-primary, #3b82f6)" }
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								style: { fontSize: 15 },
								children: t("quickGuide")
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: 10,
								fontSize: 13
							},
							children: [
								{
									title: "1. 单机无状态直连 (即指即跑 · 零会话污染)",
									code: "ssh_control(action: \"exec\", server: \"nas-server\", command: \"free -h && uname -a\")"
								},
								{
									title: "2. 多机并发广播巡检 (秒级并行调度 · 聚合输出)",
									code: "ssh_control(action: \"exec\", server: \"nas-server, app-node, web-cluster\", command: \"uptime && df -h /\")"
								},
								{
									title: "3. 远程文本精准读写 (Stdin 管道流 · 零引号转义破坏)",
									code: "ssh_control(action: \"read\", server: \"nas-server\", path: \"/etc/os-release\")"
								},
								{
									title: "4. 原生 SCP 双向流式传输 (单文件 / 目录递归)",
									code: "ssh_control(action: \"upload\", server: \"nas-server\", localPath: \"dist\", remotePath: \"/srv/web\")"
								}
							].map((item, idx) => {
								const isCopied = copyStatus[`cheat-${idx}`];
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										flexDirection: "column",
										gap: 6,
										padding: "10px 14px",
										background: "var(--dsw-alias-bg-layer-1)",
										border: "1px solid var(--dsw-alias-border-l2)",
										borderRadius: 8
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "flex",
											justifyContent: "space-between",
											alignItems: "center"
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", {
											style: {
												color: "var(--dsw-alias-label-primary)",
												fontSize: 13
											},
											children: item.title
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											style: {
												...button,
												fontSize: 11,
												padding: "3px 8px",
												display: "inline-flex",
												alignItems: "center",
												gap: 4
											},
											onClick: () => copyText(`cheat-${idx}`, item.code),
											children: [isCopied ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckIcon, {
												size: 12,
												style: { color: "#4ade80" }
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CopyIcon, { size: 12 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: isCopied ? t("copied") : t("copyServer") })]
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
										style: {
											margin: 0,
											fontFamily: "monospace",
											fontSize: 12,
											color: "var(--dsw-alias-brand-primary, #60a5fa)",
											background: "var(--dsw-alias-bg-layer-2)",
											padding: "6px 10px",
											borderRadius: 6,
											overflowX: "auto"
										},
										children: item.code
									})]
								}, idx);
							})
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.tsx
		const name = "dsh-ssh-control-client";
		const inject = ["slots", "locale"];
		/** Register the localized settings and plugin cards. */
		async function apply(ctx) {
			const namespace = "settings.ssh-control";
			ctx.effect(() => ctx.locale.register(namespace, {
				zh,
				en
			}), "dsh-ssh-control: client copy");
			const t = ctx.locale.bind(namespace);
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "ssh-control",
				order: 16,
				label: () => t("nav"),
				inject: () => ({ t })
			}, RemoteSshSettings));
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				key: namespace,
				inject: () => ({ t })
			}, RemoteSshPluginCard));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
