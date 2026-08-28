# DSH SSH Control Center

English | [中文](README.zh.md)

![DSH Plugin](https://img.shields.io/badge/DSH-Plugin-3b82f6.svg)
![License](https://img.shields.io/badge/license-Apache--2.0-green.svg)
![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20macOS-blue.svg)

A unified, non-intrusive SSH control center plugin for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) (`@dsh-external/dsh-ssh-control`).

This plugin equips DSH with **cross-platform (Linux & Windows), encoding self-healing (UTF-8 & GBK), stateless, and multi-host concurrent dispatch** capabilities. AI agents can seamlessly interact with remote Linux, NAS, Windows, and container hosts in the same session without hijacking or breaking the native local development environment.

---

## 📸 Settings & Dashboard Preview

![SSH Control Center Settings Preview](docs/preview-main.svg)

---

## 🌟 Key Features

- **Unified Composite Hub (`ssh_control`)**: Consolidates remote command execution, file IO, file transfer (`upload`/`download`), container inspection (`docker`), dynamic logs (`tail`), and port tunnels into a single tool, reducing Tool Schema token overhead by 85%+.
- **Cross-Platform Dual-Dialect (Linux POSIX + Windows PowerShell)**: Automatically senses remote OS types. Uses standard POSIX syntax for Linux hosts and PowerShell commands/paths for Windows hosts.
- **Intelligent Encoding Self-Healing (UTF-8 + GBK/CP936)**: Native multi-encoding detection and auto-transcoding for Windows Chinese systems, eliminating broken characters and garbled output.
- **Bi-Directional File Transfer (SCP Stream)**: Supports single file and directory upload (`upload`) and download (`download`), with multi-host batch dispatch.
- **Batch Multi-Host Concurrent Dispatch**: Natively supports comma-separated targets (e.g. `server: "nas-server, app-node, web-cluster"`). Powered by `Promise.all` concurrent SSH pipes for parallel batch execution and aggregated reporting.
- **Structured Container Inspection (Docker)**: Real-time structured extraction of container states, images, ports, and health status.
- **Dynamic Log Tail & Filter (Tail + Grep)**: Fast bounded log inspection from the end of files with regex error filtering (`ERROR|FATAL`).

---

## 🏛️ Architecture Overview

![SSH Control Center Architecture](docs/architecture.svg)

---

## 🛠️ Tool Specification (`ssh_control`)

DSH exposes a single compound tool `ssh_control`:

| Action | Parameters | Description |
| :--- | :--- | :--- |
| `exec` | `server`, `command`, `workdir?`, `timeoutMs?` | Execute shell commands on single or multiple hosts in parallel (cross-platform) |
| `read` | `server`, `path`, `offset?`, `limit?` | Read remote files bounded by lines |
| `write` | `server`, `path`, `content` | Write remote file content via stdin stream (zero quoting loss) |
| `upload` | `server`, `localPath`, `remotePath`, `recursive?` | Upload local file or directory to remote host(s) |
| `download` | `server`, `remotePath`, `localPath`, `recursive?` | Download remote file or directory to local machine |
| `tail` | `server`, `path`, `lines?`, `pattern?` | Tail end of logs with optional regex/keyword filtering |
| `docker` | `server`, `command?` | Structured Docker container inspection or docker commands |
| `status` | `server?` | Probe target host uptime, memory, OS, and **all disk mount watermarks** |
| `tunnel` | `server`, `port`, `targetPort?`, `tunnelAction` | Manage background SSH port-forwarding tunnels |
| `list` | *none* | Parse local `~/.ssh/config` to discover available SSH hosts |
| `attach` / `detach` | `server?`, `path?` | (Optional) Bind or unbind default server for active session |

---

## 🚀 Getting Started

### 1. Installation

```bash
# Option A: One-click install from GitHub (prebuilt bundles included)
dsh plugin --profile web add github:pipipigu/dsh-ssh-control

# Option B: Local development via link
dsh plugin --profile web add link:/path/to/dsh-ssh-control

# Launch DSH Web
dsh web
```

### 2. Usage Examples

#### Scenario 1: Status & Multi-Mount Disk Watermarks
```json
{
  "action": "status",
  "server": "nas-server"
}
```

#### Scenario 2: Batch Upload to Multiple Servers
```json
{
  "action": "upload",
  "server": "app-node-01, app-node-02",
  "localPath": "dist",
  "remotePath": "/srv/web"
}
```

#### Scenario 3: Log Extraction with Error Filtering
```json
{
  "action": "tail",
  "server": "web-cluster",
  "path": "/var/log/app.log",
  "lines": 100,
  "pattern": "ERROR|FATAL"
}
```

---

## 🧪 Testing & Verification

```bash
# Run typecheck and all 24 unit test suites
pnpm run check

# Run automated isolated port boot check & health probe in DSH root
./test-boot.sh
```

---

## 📄 License

Licensed under the [Apache-2.0 License](LICENSE).
