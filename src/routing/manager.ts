import { Context, Service } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { defaultSshConfigFiles, discoverSshConfigHosts } from '../ssh/config.ts'

export interface RemoteSshServer {
  id: string
  label: string
  sshTarget: string
  sshArgs?: string[] | undefined
  source?: string | undefined
  hostName?: string | undefined
  user?: string | undefined
  port?: number | undefined
  configPath?: string | undefined
}

export interface Config {
  sshConfigFile?: string | undefined
  servers?: RemoteSshServer[] | undefined
  defaultServerId?: string | undefined
}

export interface DiscoveredServer extends RemoteSshServer {
  source: 'config' | 'settings'
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    remoteSshManager: RemoteSshManager
  }
}

export class RemoteSshManager extends Service {
  static readonly inject = ['settings']
  private readonly configScope: SettingsScope<Config> | undefined
  private config: Config
  private discoveredHosts: DiscoveredServer[] = []
  private attachedSessions = new Map<string, { server: RemoteSshServer }>()
  public readonly initialRefresh: Promise<void>

  constructor(ctx: Context, initialConfig?: Config) {
    super(ctx, 'remoteSshManager')
    this.config = {
      ...(initialConfig?.sshConfigFile !== undefined ? { sshConfigFile: initialConfig.sshConfigFile } : {}),
      ...(initialConfig?.servers !== undefined ? { servers: initialConfig.servers } : { servers: [] }),
      ...(initialConfig?.defaultServerId !== undefined ? { defaultServerId: initialConfig.defaultServerId } : {}),
    }

    if (ctx.settings !== undefined) {
      this.configScope = ctx.settings.register(settingsNamespace('ssh-control'), z.object({
        sshConfigFile: z.string(),
        servers: z.array(z.object({
          id: z.string(),
          label: z.string(),
          sshTarget: z.string(),
        })),
        defaultServerId: z.string(),
      }) as any, {
        base: this.config as any,
      })
      this.config = this.configScope.get()
      this.configScope.watch(next => {
        this.config = next
        void this.refresh()
      })
    }

    this.initialRefresh = this.refresh()
  }

  async refresh(): Promise<void> {
    const configFiles = this.config.sshConfigFile ? [this.config.sshConfigFile] : defaultSshConfigFiles()
    const discovered: DiscoveredServer[] = []

    try {
      const result = await discoverSshConfigHosts(configFiles)
      for (const host of result.hosts) {
        discovered.push({
          id: host.id,
          label: host.label,
          sshTarget: host.sshTarget,
          hostName: host.hostName,
          user: host.user,
          port: host.port,
          source: 'config',
          configPath: host.configPath,
        })
      }
    } catch {}

    for (const server of this.config.servers ?? []) {
      discovered.push({
        id: server.id,
        label: server.label,
        sshTarget: server.sshTarget,
        source: 'settings',
      })
    }

    this.discoveredHosts = discovered
  }

  async listAvailableServers(): Promise<DiscoveredServer[]> {
    await this.initialRefresh
    return this.discoveredHosts
  }

  sessionStatus(sessionId: string): { sessionId: string; executionWorld: string; server?: RemoteSshServer; status: string } {
    const attached = this.attachedSessions.get(sessionId)
    if (attached) {
      return {
        sessionId,
        executionWorld: 'remote',
        server: attached.server,
        status: `attached to ${attached.server.label} (${attached.server.sshTarget})`,
      }
    }
    return {
      sessionId,
      executionWorld: 'local',
      status: 'ready (local execution)',
    }
  }

  async attachSession(sessionId: string, opts?: { server?: string }): Promise<any> {
    await this.initialRefresh
    const targetName = opts?.server?.trim() || this.config.defaultServerId
    if (!targetName) {
      throw new Error('attach: no server specified and no default server configured')
    }

    const server = this.discoveredHosts.find(s => s.id === targetName || s.label === targetName || s.sshTarget === targetName)
    if (!server) {
      throw new Error(`attach: server '${targetName}' not found in SSH configurations`)
    }

    this.attachedSessions.set(sessionId, { server })
    return {
      status: 'attached',
      sessionId,
      serverId: server.id,
      serverLabel: server.label,
      sshTarget: server.sshTarget,
      message: `Session now defaulting to ${server.label} (${server.sshTarget})`,
    }
  }

  async detachSession(sessionId: string): Promise<any> {
    this.attachedSessions.delete(sessionId)
    return {
      status: 'detached',
      sessionId,
      message: 'Switched back to local workspace execution.',
    }
  }

  async updateUserPreferences(prefs: { sshConfigFile?: string }): Promise<void> {
    if (this.configScope) {
      const next = { ...this.config, ...prefs }
      await this.configScope.replace(next)
      this.config = next
      await this.refresh()
    }
  }

  snapshot(): Config {
    return { ...this.config }
  }
}

export function apply(ctx: Context, config?: Config): void {
  ctx.plugin(RemoteSshManager, config)
}

export default apply
