import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { RemoteSshManager } from './manager.ts'
import {
  runRemoteSshCommand,
  readRemoteFile,
  writeRemoteFile,
  uploadViaScp,
  downloadViaScp,
  tailRemoteFile,
  parseDiskUsage,
  parseDockerList,
  startTunnel,
  stopTunnel,
  listActiveTunnels,
} from '../ssh/runner.ts'

export const name = 'dsh-ssh-control-control-tool'
export const inject = ['remoteSshManager', 'tools']

function cleanJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, val) => val === undefined ? null : val))
}

function parseTargetServers(input?: string): string[] {
  if (!input) return []
  return input
    .split(/[,;\s]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

export function apply(ctx: Context): void {
  const manager = ctx.remoteSshManager

  ctx.tools.register(defineTool({
    name: 'ssh_control',
    description: 'Unified SSH control center: execute remote commands (exec), read/write/upload/download files (read/write/upload/download), dynamic logs (tail), container inspection (docker), server metrics & disk watermarks (status), port tunnels (tunnel/forward), and session attach/detach. Supports single host or batch multi-host execution.',
    parameters: {
      action: {
        type: 'string',
        enum: [
          'exec',
          'read',
          'write',
          'upload',
          'download',
          'tail',
          'docker',
          'status',
          'tunnel',
          'list',
          'attach',
          'detach',
          'forward',
        ] as const,
        description: 'Operation to perform: exec (run shell command/script), read (read lines), write (write stream), upload (transfer local file/dir to remote), download (transfer remote file/dir to local), tail (read latest log & grep errors), docker (list containers/inspect status), status (probe OS/uptime/memory/disk watermarks), tunnel (manage SSH port forwarding), list (discover SSH hosts), attach (bind default server), detach (unbind session), forward (port forward info).',
      },
      server: {
        type: 'string',
        description: 'Target server ID, OpenSSH host alias (e.g. "nas-server"), SSH target, or multiple hosts separated by commas (e.g. "nas-server, app-node, web-cluster"). Defaults to active attached server if omitted.',
      },
      command: {
        type: 'string',
        description: 'Shell command to execute on the remote host(s) (used with action: "exec").',
      },
      path: {
        type: 'string',
        description: 'Remote file or directory path (used with read, write, tail, upload, download, exec, attach).',
      },
      localPath: {
        type: 'string',
        description: 'Local file or directory path on dev machine (used with action: "upload" and "download").',
      },
      remotePath: {
        type: 'string',
        description: 'Remote file or directory path on target machine (used with action: "upload" and "download"). Defaults to path if omitted.',
      },
      content: {
        type: 'string',
        description: 'File content to write (used with action: "write").',
      },
      offset: {
        type: 'number',
        description: '1-based line offset for reading file (used with action: "read").',
      },
      limit: {
        type: 'number',
        description: 'Maximum lines to read (used with action: "read"). Defaults to 2000.',
      },
      lines: {
        type: 'number',
        description: 'Number of lines to tail from end of file (used with action: "tail"). Defaults to 50.',
      },
      pattern: {
        type: 'string',
        description: 'Filter keyword or regular expression to search/filter lines (used with action: "tail").',
      },
      recursive: {
        type: 'boolean',
        description: 'Whether to transfer directory recursively (used with action: "upload" and "download"). Defaults to true for directories.',
      },
      workdir: {
        type: 'string',
        description: 'Working directory on remote host (used with action: "exec").',
      },
      timeoutMs: {
        type: 'number',
        description: 'Execution or transfer timeout in milliseconds. Defaults to 60000 (transfer defaults to 180000).',
      },
      port: {
        type: 'number',
        description: 'Local port number for tunnel or forward action.',
      },
      targetPort: {
        type: 'number',
        description: 'Remote target port number for tunnel or forward action (defaults to port).',
      },
      targetHost: {
        type: 'string',
        description: 'Target host for port forwarding (defaults to "127.0.0.1").',
      },
      tunnelAction: {
        type: 'string',
        enum: ['start', 'stop', 'list'] as const,
        description: 'Tunnel sub-action: start (open tunnel), stop (close tunnel), list (list active tunnels). Used with action: "tunnel".',
      },
      direction: {
        type: 'string',
        enum: ['local', 'remote'] as const,
        description: 'Forward direction: "local" (listen on local, forward to remote) or "remote" (listen on remote, forward to local).',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => {
        if (value === null || typeof value !== 'object') return [{ type: 'text', text: String(value) }]
        return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
      },
    },
    async execute(args, exec): Promise<any> {
      const sessionId = exec.agent !== undefined ? String(exec.agent.session.header.id) : 'default'
      const sessionStatus = manager.sessionStatus(sessionId)
      const parsedServers = parseTargetServers(args.server)
      const defaultServer = sessionStatus.server?.sshTarget || sessionStatus.server?.id
      const servers = parsedServers.length > 0 ? parsedServers : (defaultServer ? [defaultServer] : [])
      const isBatch = servers.length > 1
      const singleServer = servers[0]

      switch (args.action) {
        case 'list': {
          const allServers = await manager.listAvailableServers()
          return cleanJson({ servers: allServers, count: allServers.length })
        }

        case 'exec': {
          if (servers.length === 0) {
            throw new Error('ssh_control exec: no server specified and no active server attached. Provide "server" (e.g. "nas-server" or "nas-server, app-node").')
          }
          if (!args.command) {
            throw new Error('ssh_control exec: "command" parameter is required.')
          }

          if (isBatch) {
            const tasks = servers.map(async (srv) => {
              const res = await runRemoteSshCommand(srv, args.command!, {
                workdir: args.workdir || args.path,
                timeoutMs: args.timeoutMs,
              })
              return {
                server: srv,
                exitCode: res.exitCode,
                stdout: res.stdout,
                stderr: res.stderr,
                timedOut: res.timedOut,
                durationMs: res.durationMs,
              }
            })
            const results = await Promise.all(tasks)
            return cleanJson({
              mode: 'batch',
              command: args.command,
              total: servers.length,
              successful: results.filter(r => r.exitCode === 0).length,
              failed: results.filter(r => r.exitCode !== 0).length,
              results,
            })
          }

          const res = await runRemoteSshCommand(singleServer!, args.command, {
            workdir: args.workdir || args.path,
            timeoutMs: args.timeoutMs,
          })
          return cleanJson({
            server: singleServer,
            command: args.command,
            exitCode: res.exitCode,
            stdout: res.stdout,
            stderr: res.stderr,
            timedOut: res.timedOut,
            durationMs: res.durationMs,
          })
        }

        case 'read': {
          if (servers.length === 0) {
            throw new Error('ssh_control read: no server specified and no active server attached.')
          }
          if (!args.path) {
            throw new Error('ssh_control read: "path" parameter is required.')
          }

          if (isBatch) {
            const tasks = servers.map(async (srv) => {
              try {
                const res = await readRemoteFile(srv, args.path!, {
                  offset: args.offset,
                  limit: args.limit,
                })
                return {
                  server: srv,
                  path: args.path,
                  lines: res.lines,
                  content: res.content,
                }
              } catch (err: any) {
                return {
                  server: srv,
                  path: args.path,
                  error: err?.message || String(err),
                }
              }
            })
            const results = await Promise.all(tasks)
            return cleanJson({
              mode: 'batch',
              path: args.path,
              total: servers.length,
              results,
            })
          }

          const res = await readRemoteFile(singleServer!, args.path, {
            offset: args.offset,
            limit: args.limit,
          })
          return cleanJson({
            server: singleServer,
            path: args.path,
            lines: res.lines,
            content: res.content,
          })
        }

        case 'write': {
          if (servers.length === 0) {
            throw new Error('ssh_control write: no server specified and no active server attached.')
          }
          if (!args.path) {
            throw new Error('ssh_control write: "path" parameter is required.')
          }

          if (isBatch) {
            const tasks = servers.map(async (srv) => {
              try {
                const res = await writeRemoteFile(srv, args.path!, args.content ?? '')
                return {
                  server: srv,
                  path: res.path,
                  bytes: res.bytes,
                  status: 'written',
                }
              } catch (err: any) {
                return {
                  server: srv,
                  path: args.path,
                  error: err?.message || String(err),
                }
              }
            })
            const results = await Promise.all(tasks)
            return cleanJson({
              mode: 'batch',
              path: args.path,
              total: servers.length,
              results,
            })
          }

          const res = await writeRemoteFile(singleServer!, args.path, args.content ?? '')
          return cleanJson({
            server: singleServer,
            path: res.path,
            bytes: res.bytes,
            status: 'written',
          })
        }

        case 'upload': {
          if (servers.length === 0) {
            throw new Error('ssh_control upload: no server specified. Provide "server".')
          }
          if (!args.localPath) {
            throw new Error('ssh_control upload: "localPath" parameter is required.')
          }
          const targetRemotePath = args.remotePath || args.path
          if (!targetRemotePath) {
            throw new Error('ssh_control upload: "remotePath" or "path" parameter is required.')
          }

          if (isBatch) {
            const tasks = servers.map(async (srv) => {
              try {
                const res = await uploadViaScp(srv, args.localPath!, targetRemotePath, {
                  recursive: args.recursive,
                  timeoutMs: args.timeoutMs,
                })
                return { server: srv, success: true, ...res }
              } catch (err: any) {
                return { server: srv, success: false, error: err?.message || String(err) }
              }
            })
            const results = await Promise.all(tasks)
            return cleanJson({
              mode: 'batch',
              action: 'upload',
              localPath: args.localPath,
              remotePath: targetRemotePath,
              total: servers.length,
              successful: results.filter(r => r.success).length,
              failed: results.filter(r => !r.success).length,
              results,
            })
          }

          const res = await uploadViaScp(singleServer!, args.localPath, targetRemotePath, {
            recursive: args.recursive,
            timeoutMs: args.timeoutMs,
          })
          return cleanJson({
            server: singleServer,
            action: 'upload',
            ...res,
          })
        }

        case 'download': {
          if (!singleServer) {
            throw new Error('ssh_control download: no server specified.')
          }
          const targetRemotePath = args.remotePath || args.path
          if (!targetRemotePath) {
            throw new Error('ssh_control download: "remotePath" or "path" parameter is required.')
          }
          if (!args.localPath) {
            throw new Error('ssh_control download: "localPath" parameter is required.')
          }

          const res = await downloadViaScp(singleServer, targetRemotePath, args.localPath, {
            recursive: args.recursive,
            timeoutMs: args.timeoutMs,
          })
          return cleanJson({
            server: singleServer,
            action: 'download',
            ...res,
          })
        }

        case 'tail': {
          if (!singleServer) {
            throw new Error('ssh_control tail: no server specified.')
          }
          if (!args.path) {
            throw new Error('ssh_control tail: "path" parameter is required.')
          }

          const res = await tailRemoteFile(singleServer, args.path, {
            lines: args.lines,
            pattern: args.pattern,
          })
          return cleanJson(res)
        }

        case 'docker': {
          if (!singleServer) {
            throw new Error('ssh_control docker: no server specified.')
          }
          // If specific docker command requested in command arg, run it, otherwise default to listing containers
          if (args.command) {
            const cmd = args.command.startsWith('docker ') ? args.command : `docker ${args.command}`
            const res = await runRemoteSshCommand(singleServer, cmd, { timeoutMs: args.timeoutMs })
            return cleanJson({
              server: singleServer,
              command: cmd,
              exitCode: res.exitCode,
              stdout: res.stdout,
              stderr: res.stderr,
            })
          }

          const listRes = await runRemoteSshCommand(singleServer, 'docker ps -a --format "{{json .}}"', { timeoutMs: 15_000 })
          if (listRes.exitCode === 0) {
            const containers = parseDockerList(listRes.stdout)
            return cleanJson({
              server: singleServer,
              dockerReachable: true,
              totalContainers: containers.length,
              runningContainers: containers.filter(c => c.state.toLowerCase() === 'running' || c.status.toLowerCase().startsWith('up')).length,
              containers,
            })
          }

          return cleanJson({
            server: singleServer,
            dockerReachable: false,
            exitCode: listRes.exitCode,
            error: listRes.stderr || listRes.stdout || 'docker command failed or not installed',
          })
        }

        case 'status': {
          // If explicit server(s) provided in args, probe them
          if (parsedServers.length > 1) {
            const tasks = parsedServers.map(async (srv) => {
              const probeRes = await runRemoteSshCommand(srv, 'hostname && uname -a && uptime && free -h && df -h', { timeoutMs: 12_000 })
              const dfRes = await runRemoteSshCommand(srv, 'df -h', { timeoutMs: 8_000 })
              const disks = dfRes.exitCode === 0 ? parseDiskUsage(dfRes.stdout) : []
              return {
                server: srv,
                reachable: probeRes.exitCode === 0,
                exitCode: probeRes.exitCode,
                output: probeRes.stdout || probeRes.stderr,
                disks,
                durationMs: probeRes.durationMs,
              }
            })
            const results = await Promise.all(tasks)
            return cleanJson({
              mode: 'batch',
              total: parsedServers.length,
              results,
            })
          }

          if (parsedServers.length === 1) {
            const probeTarget = parsedServers[0]!
            const probeRes = await runRemoteSshCommand(probeTarget, 'hostname && uname -a && uptime && free -h', { timeoutMs: 10_000 })
            const dfRes = await runRemoteSshCommand(probeTarget, 'df -h', { timeoutMs: 8_000 })
            const disks = dfRes.exitCode === 0 ? parseDiskUsage(dfRes.stdout) : []
            return cleanJson({
              server: probeTarget,
              reachable: probeRes.exitCode === 0,
              exitCode: probeRes.exitCode,
              output: probeRes.stdout || probeRes.stderr,
              disks,
              durationMs: probeRes.durationMs,
            })
          }

          return cleanJson(sessionStatus)
        }

        case 'tunnel': {
          const subAction = args.tunnelAction ?? 'list'
          if (subAction === 'list') {
            const list = listActiveTunnels()
            return cleanJson({ count: list.length, tunnels: list })
          }

          if (subAction === 'stop') {
            const targetId = args.server ? `${args.server}-${args.port}-${args.targetPort ?? args.port}` : String(args.port)
            const stopped = stopTunnel(targetId)
            return cleanJson({ status: stopped ? 'stopped' : 'not_found', tunnelId: targetId })
          }

          if (subAction === 'start') {
            if (!singleServer) throw new Error('ssh_control tunnel start: "server" parameter is required.')
            if (!args.port) throw new Error('ssh_control tunnel start: "port" parameter is required.')
            const targetP = args.targetPort ?? args.port
            const tHost = args.targetHost ?? '127.0.0.1'
            const info = await startTunnel(singleServer, args.port, targetP, tHost)
            return cleanJson({ status: 'active', ...info })
          }

          throw new Error(`ssh_control tunnel: unknown tunnelAction '${subAction}'`)
        }

        case 'attach': {
          const result = await manager.attachSession(sessionId, {
            ...(args.server !== undefined ? { server: args.server } : {}),
            ...(args.path !== undefined ? { path: args.path } : {}),
          })
          return cleanJson(result)
        }

        case 'detach': {
          const result = await manager.detachSession(sessionId)
          return cleanJson(result)
        }

        case 'forward': {
          return cleanJson({
            status: 'forward_info',
            message: 'Port forwarding via SSH connection is managed automatically by the active host tunnel.',
            port: args.port ?? 0,
            targetPort: args.targetPort ?? args.port ?? 0,
            direction: args.direction ?? 'local',
          })
        }

        default:
          throw new Error(`dsh-ssh-control: unsupported action '${String((args as { action?: unknown }).action)}'`)
      }
    },
  }))
}
