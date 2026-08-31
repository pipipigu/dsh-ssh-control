import { spawn } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { RemoteSshManager } from '../routing/manager.ts'
import { appendSshHost, defaultSshConfigFiles } from '../ssh/config.ts'

export const ROUTE_PREFIX = '/plugins/@dsh-external/dsh-ssh-control'
export const REMOTE_SSH_STATE_PATH = `${ROUTE_PREFIX}/state`
export const REMOTE_SSH_PROBE_PATH = `${ROUTE_PREFIX}/probe`
export const REMOTE_SSH_CONFIG_HOST_PATH = `${ROUTE_PREFIX}/ssh-config/host`
export const REMOTE_SSH_SETTINGS_PATH = `${ROUTE_PREFIX}/settings`

export const name = 'dsh-ssh-control-web'
export const inject = ['remoteSshManager']

/** Activate the Web surface only in compositions that provide a Web host. */
export function apply(ctx: Context): void {
  ctx.inject(['webServer'], (child) => {
    child.effect(() => {
      const server = (child as any).webServer
      if (!server || typeof server.register !== 'function') return () => {}

      const disposers: Array<() => void> = []

      // 1. /state
      disposers.push(server.register({
        kind: 'exact',
        path: REMOTE_SSH_STATE_PATH,
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== 'GET') {
            json(res, 405, { error: 'Method not allowed' })
            return
          }
          try {
            json(res, 200, await catalogState(child.remoteSshManager))
          } catch (err: any) {
            json(res, 500, { error: err?.message || String(err) })
          }
        },
      }))

      // 2. /settings
      disposers.push(server.register({
        kind: 'exact',
        path: REMOTE_SSH_SETTINGS_PATH,
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== 'POST') {
            json(res, 405, { error: 'Method not allowed' })
            return
          }
          try {
            const body = await readJson(req)
            const sshConfigFile = optionalString(body, 'sshConfigFile')
            await child.remoteSshManager.updateUserPreferences({
              ...(sshConfigFile === undefined ? {} : { sshConfigFile }),
            })
            const snapshot = child.remoteSshManager.snapshot()
            json(res, 200, {
              sshConfigFile: snapshot.sshConfigFile,
            })
          } catch (err: any) {
            json(res, 500, { error: err?.message || String(err) })
          }
        },
      }))

      // 3. /probe
      disposers.push(server.register({
        kind: 'exact',
        path: REMOTE_SSH_PROBE_PATH,
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== 'POST') {
            json(res, 405, { error: 'Method not allowed' })
            return
          }
          try {
            const body = await readJson(req)
            const serverId = requiredString(body, 'id')
            const servers = await child.remoteSshManager.listAvailableServers()
            const target = servers.find((s: any) => s.id === serverId || s.label === serverId || s.sshTarget === serverId)
            if (!target) {
              json(res, 404, { error: `Unknown server ID '${serverId}'` })
              return
            }
            json(res, 200, await probeServer(target.sshTarget))
          } catch (err: any) {
            json(res, 500, { error: err?.message || String(err) })
          }
        },
      }))

      // 4. /ssh-config/host
      disposers.push(server.register({
        kind: 'exact',
        path: REMOTE_SSH_CONFIG_HOST_PATH,
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== 'POST') {
            json(res, 405, { error: 'Method not allowed' })
            return
          }
          try {
            const body = await readJson(req)
            const command = requiredString(body, 'command')
            const configPath = requiredString(body, 'configPath')
            await appendSshHost(configPath, command)
            await child.remoteSshManager.refresh()
            json(res, 200, { ok: true })
          } catch (err: any) {
            json(res, 500, { error: err?.message || String(err) })
          }
        },
      }))

      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'dsh-ssh-control-web-routes')
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
