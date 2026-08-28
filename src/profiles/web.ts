import { spawn } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { RemoteSshManager } from '../routing/manager.ts'
import { appendSshHost, defaultSshConfigFiles } from '../ssh/config.ts'

export const REMOTE_SSH_STATE_PATH = '/plugins/@dsh-external/dsh-ssh-control/state'
export const REMOTE_SSH_PROBE_PATH = '/plugins/@dsh-external/dsh-ssh-control/probe'
export const REMOTE_SSH_CONFIG_HOST_PATH = '/plugins/@dsh-external/dsh-ssh-control/ssh-config/host'
export const REMOTE_SSH_SETTINGS_PATH = '/plugins/@dsh-external/dsh-ssh-control/settings'

export const name = 'dsh-ssh-control-web'
export const inject = ['remoteSshManager']

/** Activate the Web surface only in compositions that provide a Web host. */
export function apply(ctx: Context): void {
  ctx.inject(['webServer'], registerWebRoutes)
}

/** Register same-origin catalog mutation and connection-probe endpoints. */
function registerWebRoutes(ctx: Context): void {
  route(ctx, REMOTE_SSH_STATE_PATH, 'GET', async (_req, res) => {
    json(res, 200, await catalogState(ctx.remoteSshManager))
  })
  route(ctx, REMOTE_SSH_SETTINGS_PATH, 'POST', async (req, res) => {
    const body = await readJson(req)
    const sshConfigFile = optionalString(body, 'sshConfigFile')
    await ctx.remoteSshManager.updateUserPreferences({
      ...(sshConfigFile === undefined ? {} : { sshConfigFile }),
    })
    const snapshot = ctx.remoteSshManager.snapshot()
    json(res, 200, {
      sshConfigFile: snapshot.sshConfigFile,
    })
  })
  route(ctx, REMOTE_SSH_PROBE_PATH, 'POST', async (req, res) => {
    const body = await readJson(req)
    const serverId = requiredString(body, 'id')
    const servers = await ctx.remoteSshManager.listAvailableServers()
    const server = servers.find(s => s.id === serverId || s.label === serverId || s.sshTarget === serverId)
    if (!server) {
      throw new Error(`Unknown server ID '${serverId}'`)
    }
    json(res, 200, await probeServer(server.sshTarget))
  })
  route(ctx, REMOTE_SSH_CONFIG_HOST_PATH, 'POST', async (req, res) => {
    const body = await readJson(req)
    const command = requiredString(body, 'command')
    const configPath = requiredString(body, 'configPath')
    await appendSshHost(configPath, command)
    await ctx.remoteSshManager.refresh()
    json(res, 200, { ok: true })
  })
}

async function catalogState(manager: RemoteSshManager): Promise<any> {
  const servers = await manager.listAvailableServers()
  const snapshot = manager.snapshot()
  return {
    servers: servers.map(s => ({
      id: s.id,
      label: s.label,
      sshTarget: s.sshTarget,
      source: s.source,
      hostName: s.hostName,
      user: s.user,
      port: s.port,
      configPath: s.configPath,
    })),
    discoveredServerCount: servers.length,
    workspaceCount: 0,
    workspaces: [],
    configFiles: defaultSshConfigFiles(),
    configErrors: [],
    customConfigFile: snapshot.sshConfigFile,
  }
}

async function probeServer(sshTarget: string): Promise<any> {
  return new Promise((resolve) => {
    const child = spawn('ssh', ['-o', 'BatchMode=yes', sshTarget, 'hostname && uname -s'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({ reachable: false, error: 'Connection timed out' })
    }, 10_000)

    child.stdout.on('data', d => stdout += d.toString())
    child.stderr.on('data', d => stderr += d.toString())

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        const lines = stdout.trim().split('\n')
        resolve({
          reachable: true,
          hostname: lines[0] || sshTarget,
          commands: { bash: true, uname: true },
        })
      } else {
        resolve({
          reachable: false,
          error: stderr.trim() || `ssh exit ${code}`,
        })
      }
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ reachable: false, error: err.message })
    })
  })
}

function route(ctx: Context, path: string, method: string, handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>): () => void {
  return (ctx as any).webServer.route(path, method, handler)
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

function requiredString(body: any, key: string): string {
  const val = body[key]
  if (typeof val !== 'string' || val.trim().length === 0) throw new Error(`Missing required field '${key}'`)
  return val.trim()
}

function optionalString(body: any, key: string): string | undefined {
  const val = body[key]
  return typeof val === 'string' && val.trim().length > 0 ? val.trim() : undefined
}
