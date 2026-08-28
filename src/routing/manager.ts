import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import { posix } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { ShellExecutor } from '@deepseek-ai/dsh-shell'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-workspace'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import z from '@deepseek-ai/schemastery'
import RemoteSshFileSystem from '../transport/fs.ts'
import RemoteSshRuntime, { fileUriFromPosixPath, posixPathFromFileUri, WorkspacePathMapper } from '../transport/runtime.ts'
import RemoteSshShellExecutor from '../transport/shell.ts'
import { DEFAULT_DSH_BACKEND_PORT, RemoteDshWebProxy } from '../backend/web.ts'
import { RemoteDshHostClient } from '../backend/client.ts'
import { RemoteDshHostConnection } from '../backend/connection.ts'
import type { DshHostProgress } from '../backend/tunnel.ts'
import { defaultSshConfigFiles, discoverSshConfigHosts } from '../ssh/config.ts'

/** One SSH destination visible in Settings and workspace selection. */
export interface RemoteSshServer {
  id: string
  label: string
  sshTarget: string
  sshArgs?: string[]
  remoteCodeCommand?: string
  sshExecutable?: string
  /** Optional fixed override; zero lets the singleton choose a free port. */
  backendPort?: number
}

export interface BackendConnectionProgress extends DshHostProgress {
  error?: string
}

/** Durable projection from one local alias directory to one remote directory. */
export interface RemoteSshWorkspace {
  id: string
  serverId: string
  remotePath: string
  aliasPath?: string
  title?: string
}

/** Host-side policy for file links produced inside a remote Session. */
export type RemoteOpenFileMode = 'auto' | 'vscode' | 'cursor' | 'windsurf' | 'vscodium' | 'custom' | 'download'

/** Multi-host transparent routing configuration. */
export interface Config {
  aliasRoot?: string
  /** Absolute OpenSSH config path. Empty uses the platform user and system defaults. */
  sshConfigFile?: string
  servers?: RemoteSshServer[]
  workspaces?: RemoteSshWorkspace[]
  /** Prefer a VS Code-compatible Remote SSH editor; download is the fallback. */
  openFileMode?: RemoteOpenFileMode
  /** Absolute executable path used when openFileMode is custom. */
  openFileEditorPath?: string
  /** Maximum size of one downloaded fallback snapshot. */
  openFileDownloadMaxBytes?: number
  startupTimeoutMs?: number
  requestTimeoutMs?: number
  /** Default SSH server ID or target to connect to automatically. */
  defaultServerId?: string
  /** Whether to automatically connect new sessions to defaultServerId. */
  autoConnect?: boolean
}

interface ResolvedConfig {
  aliasRoot: string
  sshConfigFile?: string
  servers: RemoteSshServer[]
  workspaces: RemoteSshWorkspace[]
  openFileMode: RemoteOpenFileMode
  openFileEditorPath?: string
  openFileDownloadMaxBytes: number
  startupTimeoutMs: number
  requestTimeoutMs: number
  defaultServerId?: string
  autoConnect: boolean
}

export interface AvailableServerSummary {
  id: string
  label: string
  sshTarget: string
  source: 'settings' | 'config'
  hostName?: string | undefined
  user?: string | undefined
  port?: number | undefined
  isDefault?: boolean | undefined
}

export interface SessionAttachResult {
  [key: string]: unknown
  status: 'attached'
  sessionId: string
  serverId: string
  serverLabel: string
  sshTarget: string
  remotePath: string
  aliasPath: string
}

export interface SessionDetachResult {
  [key: string]: unknown
  status: 'detached'
  sessionId: string
  message: string
}

export interface SessionStatusResult {
  [key: string]: unknown
  sessionId: string
  executionWorld: 'local' | 'remote'
  server?: {
    id: string
    label: string
    sshTarget: string
  } | undefined
  remotePath?: string | undefined
  aliasPath?: string | undefined
  status: string
}

export interface RemoteWorkspaceRoute {
  kind: 'remote'
  server: RemoteSshServer
  workspace: RemoteSshWorkspace
  aliasPath: string
  mapper: WorkspacePathMapper
}

export interface LocalWorkspaceRoute {
  kind: 'local'
}

export type ExecutionRoute = LocalWorkspaceRoute | RemoteWorkspaceRoute

export interface RemoteWorkspaceContext {
  ctx: Context
  fs: FileSystem
  remote: RemoteSshRuntime
}

interface RemoteHostContext {
  ctx: Context
  remote: RemoteSshRuntime
  key: string
  server: RemoteSshServer
  transport: RemoteSshTransport
}

interface RemoteWorkspaceShellContext {
  ctx: Context
  shell: ShellExecutor
  remote: RemoteSshRuntime
}

export interface RemoteSshTransport {
  executable: string
  args: string[]
  multiplexed: boolean
}

export interface RemoteDirectoryEntry {
  name: string
  path: string
}

export interface RemoteDirectoryListing {
  path: string
  home: string
  parent?: string
  entries: RemoteDirectoryEntry[]
}

const SETTINGS_NAMESPACE = settingsNamespace('remote-ssh')
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

const serverSchema: z<RemoteSshServer> = z.object({
  id: z.string().required(),
  label: z.string().required(),
  sshTarget: z.string().required(),
  sshArgs: z.array(z.string()),
  remoteCodeCommand: z.string(),
  sshExecutable: z.string(),
  backendPort: z.number(),
})

const workspaceSchema: z<RemoteSshWorkspace> = z.object({
  id: z.string().required(),
  serverId: z.string().required(),
  remotePath: z.string().required(),
  aliasPath: z.string(),
  title: z.string(),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    remoteSshManager: RemoteSshManager
  }
}

/**
 * Owns the durable host/workspace catalog and lazy remote workspace contexts.
 * An alias that was once remote remains a remote tombstone after removal, so
 * stale sessions fail closed instead of silently running on the local host.
 */
export class RemoteSshManager extends Service {
  static inject = ['settings']

  static Config: z<Config> = z.object({
    aliasRoot: z.string().default(resolve(process.env.DSH_HOME ?? resolve(process.env.USERPROFILE ?? '.', '.dsh'), 'remote-ssh', 'workspaces')),
    sshConfigFile: z.string(),
    servers: z.array(serverSchema).default([]),
    workspaces: z.array(workspaceSchema).default([]),
    openFileMode: z.union(['auto', 'vscode', 'cursor', 'windsurf', 'vscodium', 'custom', 'download'] as const).default('auto'),
    openFileEditorPath: z.string(),
    openFileDownloadMaxBytes: z.number().default(64 * 1024 * 1024),
    startupTimeoutMs: z.number().default(600_000),
    requestTimeoutMs: z.number().default(30_000),
    defaultServerId: z.string(),
    autoConnect: z.boolean().default(false),
  })

  private readonly entry: ResolvedConfig
  private current: ResolvedConfig
  private settings: SettingsScope<Config> | undefined
  private readonly routes = new Map<string, RemoteWorkspaceRoute>()
  private readonly routeByWorkspaceId = new Map<string, RemoteWorkspaceRoute>()
  private readonly remoteAliases = new Set<string>()
  private readonly contexts = new Map<string, Promise<RemoteWorkspaceContext>>()
  private readonly shellContexts = new Map<string, Promise<RemoteWorkspaceShellContext>>()
  private readonly hosts = new Map<string, Promise<RemoteHostContext>>()
  private readonly backendTunnels = new Map<string, Promise<RemoteDshHostConnection>>()
  private readonly webProxies = new Map<string, Promise<RemoteDshWebProxy>>()
  private readonly backendProgress = new Map<string, BackendConnectionProgress>()
  private readonly backendProgressListeners = new Map<string, Set<(progress: BackendConnectionProgress) => void>>()
  private readonly sessionWorlds = new Map<string, {
    owner: object
    workspaceId: string | null
    removedAlias?: string
  }>()
  private workspaceRegistry: WorkspaceRegistry | undefined
  private refreshTail: Promise<void> = Promise.resolve()
  private readonly initialRefresh: Promise<void>

  constructor(ctx: Context, config: Config) {
    super(ctx, 'remoteSshManager')
    this.entry = {
      aliasRoot: config.aliasRoot ?? resolve(process.env.DSH_HOME ?? resolve(process.env.USERPROFILE ?? '.', '.dsh'), 'remote-ssh', 'workspaces'),
      servers: config.servers ?? [],
      workspaces: config.workspaces ?? [],
      openFileMode: config.openFileMode ?? 'auto',
      openFileDownloadMaxBytes: config.openFileDownloadMaxBytes ?? 64 * 1024 * 1024,
      startupTimeoutMs: config.startupTimeoutMs ?? 600_000,
      requestTimeoutMs: config.requestTimeoutMs ?? 30_000,
      autoConnect: config.autoConnect ?? false,
      ...(config.sshConfigFile !== undefined ? { sshConfigFile: config.sshConfigFile } : {}),
      ...(config.openFileEditorPath !== undefined ? { openFileEditorPath: config.openFileEditorPath } : {}),
      ...(config.defaultServerId !== undefined ? { defaultServerId: config.defaultServerId } : {}),
    }
    this.current = this.entry
    this.validate(this.entry)
    this.initialRefresh = this.queueRefresh(this.entry)

    ctx.inject(['workspaceRegistry'], workspaceCtx => {
      this.workspaceRegistry = workspaceCtx.workspaceRegistry
      void this.registerAllWorkspaces().catch(error => { this.ctx.logger.error(error) })
      workspaceCtx.effect(() => () => {
        if (this.workspaceRegistry === workspaceCtx.workspaceRegistry) this.workspaceRegistry = undefined
      }, 'Remote SSH workspace registry attachment')
    })

    const scope = ctx.settings.register(SETTINGS_NAMESPACE, RemoteSshManager.Config, {
      base: this.entry,
      applies: 'live',
      validate: value => { this.validate(value as ResolvedConfig) },
    })
    this.settings = scope
    void this.queueRefresh(scope.get() as ResolvedConfig)
    const unwatch = scope.watch(next => this.queueRefresh(next as ResolvedConfig))
    ctx.effect(() => () => {
      unwatch()
      if (this.settings === scope) this.settings = undefined
    }, 'Remote SSH settings watch')

    ctx.effect(() => async () => {
      await this.refreshTail
      const contexts = await Promise.allSettled(this.contexts.values())
      await Promise.allSettled(contexts.flatMap(result => result.status === 'fulfilled' ? [result.value.ctx.fiber.dispose()] : []))
      this.contexts.clear()
      const shells = await Promise.allSettled(this.shellContexts.values())
      await Promise.allSettled(shells.flatMap(result => result.status === 'fulfilled' ? [result.value.ctx.fiber.dispose()] : []))
      this.shellContexts.clear()
      const hosts = await Promise.allSettled(this.hosts.values())
      await Promise.allSettled(hosts.flatMap(result => result.status === 'fulfilled' ? [this.disposeHost(result.value)] : []))
      this.hosts.clear()
      const proxies = await Promise.allSettled(this.webProxies.values())
      await Promise.allSettled(proxies.flatMap(result => result.status === 'fulfilled' ? [result.value.dispose()] : []))
      this.webProxies.clear()
      const tunnels = await Promise.allSettled(this.backendTunnels.values())
      await Promise.allSettled(tunnels.flatMap(result => result.status === 'fulfilled' ? [result.value.dispose()] : []))
      this.backendTunnels.clear()
      this.backendProgressListeners.clear()
    }, 'Remote SSH workspace context teardown')
  }

  /** Wait until the composition-layer catalog has published its aliases. */
  protected async [Service.init](): Promise<void> {
    await this.initialRefresh
  }

  /** Current detached catalog snapshot. */
  snapshot(): ResolvedConfig {
    return structuredClone(this.current)
  }

  /** Select one custom OpenSSH config, or restore the platform defaults. */
  async setSshConfigFile(path?: string): Promise<void> {
    await this.updateUserPreferences({ sshConfigFile: path ?? '' })
  }

  /** Update the native remote editor preference and its download fallback limit. */
  async setOpenFileSettings(input: {
    mode: RemoteOpenFileMode
    editorPath?: string
  }): Promise<void> {
    await this.updateUserPreferences({
      openFileMode: input.mode,
      openFileEditorPath: input.editorPath ?? '',
    })
  }

  /** Atomically update user-facing plugin preferences. Empty paths clear overrides. */
  async updateUserPreferences(input: {
    sshConfigFile?: string
    openFileMode?: RemoteOpenFileMode
    openFileEditorPath?: string
    defaultServerId?: string
    autoConnect?: boolean
  }): Promise<void> {
    const next = this.snapshot()
    if (input.sshConfigFile !== undefined) {
      if (input.sshConfigFile.trim() === '') delete next.sshConfigFile
      else next.sshConfigFile = input.sshConfigFile.trim()
    }
    if (input.openFileMode !== undefined) next.openFileMode = input.openFileMode
    if (input.openFileEditorPath !== undefined) {
      if (input.openFileEditorPath.trim() === '') delete next.openFileEditorPath
      else next.openFileEditorPath = input.openFileEditorPath.trim()
    }
    if (input.defaultServerId !== undefined) {
      if (input.defaultServerId.trim() === '') delete next.defaultServerId
      else next.defaultServerId = input.defaultServerId.trim()
    }
    if (input.autoConnect !== undefined) next.autoConnect = input.autoConnect
    this.validate(next)
    await this.replaceSettings(next)
  }

  /** Discover all available servers from settings and OpenSSH config. */
  async listAvailableServers(): Promise<AvailableServerSummary[]> {
    const snapshot = this.snapshot()
    const configFiles = snapshot.sshConfigFile === undefined ? defaultSshConfigFiles() : [snapshot.sshConfigFile]
    const discovered = await discoverSshConfigHosts(configFiles).catch(() => ({ hosts: [], files: [], errors: [] }))
    const results = new Map<string, AvailableServerSummary>()
    for (const host of discovered.hosts) {
      results.set(host.sshTarget.toLowerCase(), {
        id: host.id,
        label: host.label,
        sshTarget: host.sshTarget,
        source: 'config',
        hostName: host.hostName,
        user: host.user,
        port: host.port,
        isDefault: snapshot.defaultServerId === host.id || snapshot.defaultServerId === host.sshTarget,
      })
    }
    for (const server of snapshot.servers) {
      results.set(server.sshTarget.toLowerCase(), {
        id: server.id,
        label: server.label,
        sshTarget: server.sshTarget,
        source: 'settings',
        isDefault: snapshot.defaultServerId === server.id || snapshot.defaultServerId === server.sshTarget,
      })
    }
    return [...results.values()].sort((a, b) => a.label.localeCompare(b.label))
  }

  /** Find or dynamically create an SSH server definition. */
  async findOrCreateServer(target?: string): Promise<RemoteSshServer> {
    const snapshot = this.snapshot()
    const normalized = target?.trim()
    if (!normalized) {
      if (snapshot.defaultServerId) {
        const def = snapshot.servers.find(s => s.id === snapshot.defaultServerId || s.sshTarget.toLowerCase() === snapshot.defaultServerId?.toLowerCase())
        if (def) return def
      }
      if (snapshot.servers.length > 0) return snapshot.servers[0]!
      const available = await this.listAvailableServers()
      if (available.length > 0) {
        const first = available[0]!
        return this.addServer({ id: first.id, label: first.label, sshTarget: first.sshTarget })
      }
      throw new Error('dsh-ssh-control: no SSH server configured or discovered in OpenSSH config')
    }
    // 1. match existing servers by id or sshTarget or label
    const existing = snapshot.servers.find(s =>
      s.id === normalized || s.sshTarget.toLowerCase() === normalized.toLowerCase() || s.label.toLowerCase() === normalized.toLowerCase()
    )
    if (existing) return existing
    // 2. match discovered host
    const available = await this.listAvailableServers()
    const matched = available.find(s =>
      s.id === normalized || s.sshTarget.toLowerCase() === normalized.toLowerCase() || s.label.toLowerCase() === normalized.toLowerCase()
    )
    if (matched) {
      return this.addServer({ id: matched.id, label: matched.label, sshTarget: matched.sshTarget })
    }
    // 3. create new server with given target
    return this.addServer({ label: normalized, sshTarget: normalized })
  }

  /** Find or dynamically create an in-memory ephemeral workspace route for a session attach without polluting workspace registry. */
  async findOrCreateWorkspace(server: RemoteSshServer, remotePath?: string): Promise<RemoteWorkspaceRoute> {
    let targetPath = remotePath?.trim()
    if (!targetPath) {
      const existingWf = this.snapshot().workspaces.find(w => w.serverId === server.id)
      if (existingWf) {
        const route = this.routeByWorkspaceId.get(existingWf.id)
        if (route) return route
        targetPath = existingWf.remotePath
      } else {
        targetPath = '/'
        try {
          const host = await this.hostContext(server)
          const connection = await host.remote.getConnection()
          if (connection.defaultDirectory) {
            targetPath = posixPathFromFileUri(String(connection.defaultDirectory))
          }
        } catch {
          targetPath = '/'
        }
      }
    }
    const normalized = posix.normalize(targetPath)
    for (const route of this.routeByWorkspaceId.values()) {
      if (route.server.id === server.id && posix.normalize(route.workspace.remotePath) === normalized) {
        return route
      }
    }
    // Create an in-memory ephemeral route that does NOT persist into Settings or WorkspaceRegistry
    const tempId = `ephemeral-${randomUUID()}`
    const aliasPath = resolve(this.current.aliasRoot, tempId)
    await mkdir(aliasPath, { recursive: true })
    const canonicalAlias = resolve(aliasPath)
    const workspace: RemoteSshWorkspace = { id: tempId, serverId: server.id, remotePath: normalized }
    const route: RemoteWorkspaceRoute = {
      kind: 'remote',
      server,
      workspace,
      aliasPath: canonicalAlias,
      mapper: new WorkspacePathMapper(canonicalAlias, normalized),
    }
    this.routes.set(normalizeLocal(canonicalAlias), route)
    this.routeByWorkspaceId.set(tempId, route)
    this.remoteAliases.add(normalizeLocal(canonicalAlias))
    return route
  }

  /** Dynamically attach/switch execution world for a session. */
  async attachSession(sessionId: string, target?: { server?: string; path?: string }): Promise<SessionAttachResult> {
    const server = await this.findOrCreateServer(target?.server)
    const route = await this.findOrCreateWorkspace(server, target?.path)
    const owner = this.sessionWorlds.get(sessionId)?.owner ?? this
    this.sessionWorlds.set(sessionId, {
      owner,
      workspaceId: route.workspace.id,
    })
    this.ctx.emit('remote-ssh/session-attached', { sessionId, route })
    return {
      status: 'attached',
      sessionId,
      serverId: route.server.id,
      serverLabel: route.server.label,
      sshTarget: route.server.sshTarget,
      remotePath: route.workspace.remotePath,
      aliasPath: route.aliasPath,
    }
  }

  /** Detach a session from remote execution and switch back to local. */
  async detachSession(sessionId: string): Promise<SessionDetachResult> {
    const owner = this.sessionWorlds.get(sessionId)?.owner ?? this
    this.sessionWorlds.set(sessionId, {
      owner,
      workspaceId: null,
    })
    this.ctx.emit('remote-ssh/session-detached', { sessionId })
    return {
      status: 'detached',
      sessionId,
      message: 'Switched back to local workspace execution.',
    }
  }

  /** Get session execution world status and connection info. */
  sessionStatus(sessionId: string): SessionStatusResult {
    const route = this.sessionRoute(sessionId)
    if (route === undefined || route.kind === 'local') {
      return {
        sessionId,
        executionWorld: 'local',
        status: 'ready (local execution)',
      }
    }
    return {
      sessionId,
      executionWorld: 'remote',
      server: {
        id: route.server.id,
        label: route.server.label,
        sshTarget: route.server.sshTarget,
      },
      remotePath: route.workspace.remotePath,
      aliasPath: route.aliasPath,
      status: 'ready (transparent remote execution)',
    }
  }

  /** Browse directories through the server's shared AHP filesystem connection. */
  async listRemoteDirectory(server: RemoteSshServer, requestedPath?: string): Promise<RemoteDirectoryListing> {
    const host = await this.hostContext(server)
    const connection = await host.remote.getConnection()
    const home = connection.defaultDirectory === undefined
      ? '/'
      : posixPathFromFileUri(String(connection.defaultDirectory))
    const path = posix.normalize(requestedPath?.trim() || home)
    if (!posix.isAbsolute(path)) throw new Error('remote directory path must be an absolute POSIX path')
    const listed = await connection.client.resourceList({ uri: fileUriFromPosixPath(path) })
    return {
      path,
      home,
      ...(path === '/' ? {} : { parent: posix.dirname(path) }),
      entries: listed.entries
        .filter(entry => entry.type === 'directory')
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(entry => ({ name: entry.name, path: posix.join(path, entry.name) })),
    }
  }

  /** Create a server entry through the settings provider. */
  async addServer(input: Omit<RemoteSshServer, 'id'> & { id?: string }): Promise<RemoteSshServer> {
    const server: RemoteSshServer = { ...input, id: input.id ?? randomUUID() }
    const next = this.snapshot()
    next.servers.push(server)
    this.validate(next)
    await this.replaceSettings(next)
    return server
  }

  /** Create and register one remote workspace alias. */
  async addWorkspace(serverId: string, remotePath: string): Promise<RemoteWorkspaceRoute> {
    const workspace: RemoteSshWorkspace = { id: randomUUID(), serverId, remotePath }
    const next = this.snapshot()
    next.workspaces.push(workspace)
    this.validate(next)
    await this.replaceSettings(next)
    await this.refreshTail
    const route = this.routeByWorkspaceId.get(workspace.id)
    if (route === undefined) throw new Error(`remote workspace '${workspace.id}' was not published`)
    return route
  }

  /** Rename one remote workspace without changing its execution route. */
  async renameWorkspace(id: string, title: string): Promise<RemoteWorkspaceRoute> {
    const normalizedTitle = title.trim()
    if (normalizedTitle.length === 0) throw new Error('remote workspace title must not be empty')
    const next = this.snapshot()
    const workspace = next.workspaces.find(candidate => candidate.id === id)
    if (workspace === undefined) throw new Error(`dsh-ssh-control: unknown remote workspace '${id}'`)
    workspace.title = normalizedTitle
    this.validate(next)
    await this.replaceSettings(next)
    const route = this.routeByWorkspaceId.get(id)
    if (route === undefined) throw new Error(`remote workspace '${id}' was not published`)
    return route
  }

  /** Remove execution routing while retaining alias, Workspace, and Session history. */
  async removeWorkspace(id: string): Promise<boolean> {
    const next = this.snapshot()
    const before = next.workspaces.length
    next.workspaces = next.workspaces.filter(workspace => workspace.id !== id)
    if (next.workspaces.length === before) return false
    await this.replaceSettings(next)
    return true
  }

  /** Remove one server and tombstone all of its workspace execution routes. */
  async removeServer(id: string): Promise<boolean> {
    const next = this.snapshot()
    const before = next.servers.length
    next.servers = next.servers.filter(server => server.id !== id)
    if (next.servers.length === before) return false
    next.workspaces = next.workspaces.filter(workspace => workspace.serverId !== id)
    await this.replaceSettings(next)
    return true
  }

  /** Pre-register a local directory with the stable LOCAL display prefix. */
  async adoptLocalWorkspace(path: string): Promise<string> {
    const registry = this.workspaceRegistry
    if (registry === undefined) throw new Error('dsh-ssh-control: workspace registry is unavailable')
    const absolute = resolve(path)
    const title = `LOCAL > ${basename(absolute)}`
    const workspace = await registry.create(absolute, title)
    if (workspace.title !== title) await workspace.setTitle(title)
    return workspace.path
  }

  /** Resolve a tool path/cwd into the only execution world allowed to handle it. */
  route(path?: string, cwd?: string): ExecutionRoute {
    const cwdRoute = cwd === undefined ? undefined : this.findAlias(cwd)
    if (cwdRoute !== undefined) return cwdRoute
    if (cwd !== undefined && this.wasRemoteAlias(cwd)) {
      throw new Error(`dsh-ssh-control: workspace alias is no longer configured: ${cwd}`)
    }
    if (path !== undefined && isAbsolute(path)) {
      const pathRoute = this.findAlias(path)
      if (pathRoute !== undefined) return pathRoute
      if (this.wasRemoteAlias(path)) {
        throw new Error(`dsh-ssh-control: workspace alias is no longer configured: ${path}`)
      }
    }
    const remotePathRoute = cwd === undefined ? undefined : this.findRemotePath(cwd)
    if (remotePathRoute !== undefined) return remotePathRoute
    const absoluteRemotePathRoute = path === undefined ? undefined : this.findRemotePath(path)
    if (absoluteRemotePathRoute !== undefined) return absoluteRemotePathRoute
    return { kind: 'local' }
  }

  /** Pin shell dispatch to the session workspace, regardless of an explicit tool workdir. */
  bindSession(sessionId: string, owner: object, cwd?: string): ExecutionRoute | undefined {
    if (cwd !== undefined && this.wasRemoteAlias(cwd)) {
      const route = this.findAlias(cwd)
      if (route !== undefined) {
        this.sessionWorlds.set(sessionId, { owner, workspaceId: route.workspace.id })
        return route
      }
      this.sessionWorlds.set(sessionId, { owner, workspaceId: null, removedAlias: cwd })
      return undefined
    }
    let route = cwd === undefined ? { kind: 'local' as const } : this.route(undefined, cwd)
    if (route.kind === 'local' && (this.current.autoConnect || this.current.defaultServerId !== undefined)) {
      const defaultServer = this.current.servers.find(s =>
        s.id === this.current.defaultServerId || s.sshTarget.toLowerCase() === this.current.defaultServerId?.toLowerCase()
      ) ?? (this.current.autoConnect ? this.current.servers[0] : undefined)
      if (defaultServer !== undefined) {
        const defaultWf = this.current.workspaces.find(w => w.serverId === defaultServer.id)
        if (defaultWf !== undefined) {
          const defaultRoute = this.routeByWorkspaceId.get(defaultWf.id)
          if (defaultRoute !== undefined) route = defaultRoute
        }
      }
    }
    this.sessionWorlds.set(sessionId, {
      owner,
      workspaceId: route.kind === 'remote' ? route.workspace.id : null,
    })
    return route
  }

  /** Release only the binding owned by this exact live Agent. */
  unbindSession(sessionId: string, owner: object): void {
    if (this.sessionWorlds.get(sessionId)?.owner === owner) this.sessionWorlds.delete(sessionId)
  }

  /** Resolve the execution world bound to a live session without consulting path text. */
  sessionRoute(sessionId: string): ExecutionRoute | undefined {
    const bound = this.sessionWorlds.get(sessionId)
    if (bound === undefined) return undefined
    if (bound.removedAlias !== undefined) {
      throw new Error(`dsh-ssh-control: workspace alias is no longer configured: ${bound.removedAlias}`)
    }
    return bound.workspaceId === null ? { kind: 'local' } : this.workspace(bound.workspaceId)
  }

  /** Resolve shell calls using their durable session world before considering workdir text. */
  routeShell(workdir: string, sessionId?: string): ExecutionRoute {
    const bound = sessionId === undefined ? undefined : this.sessionRoute(sessionId)
    if (bound !== undefined) return bound
    return this.route(undefined, workdir)
  }

  /** Model-facing shell dialect for a workspace cwd. Remote workspaces are POSIX today. */
  dialectFor(cwd?: string): 'bash' | 'pwsh' {
    if (cwd !== undefined && (this.findAlias(cwd) !== undefined || this.wasRemoteAlias(cwd) || this.findRemotePath(cwd) !== undefined)) {
      return 'bash'
    }
    return process.platform === 'win32' ? 'pwsh' : 'bash'
  }

  /** Presentation-only logical cwd that never exposes the local UUID alias. */
  displayRemoteCwd(route: RemoteWorkspaceRoute, workdir?: string): string {
    const remotePath = workdir === undefined || workdir.trim() === ''
      ? route.workspace.remotePath
      : route.mapper.toRemotePath(workdir, route.aliasPath)
    const normalized = posix.normalize(remotePath)
    const workspaceRoot = posix.normalize(route.workspace.remotePath)
    const relativePath = posix.relative(workspaceRoot, normalized)
    const workspaceTitle = route.workspace.title
      ?? `${route.server.label} > ${posix.basename(workspaceRoot) || workspaceRoot}`
    if (relativePath === '' || (relativePath !== '..' && !relativePath.startsWith('../') && !posix.isAbsolute(relativePath))) {
      return posix.join('/', workspaceTitle, relativePath)
    }
    return posix.join('/', `${route.server.label} > remote`, normalized)
  }

  /** Lookup a published route by its durable workspace id. */
  workspace(id: string): RemoteWorkspaceRoute {
    const route = this.routeByWorkspaceId.get(id)
    if (route === undefined) throw new Error(`dsh-ssh-control: unknown or removed remote workspace '${id}'`)
    return route
  }

  /** Lazily boot the AHP filesystem context for one remote workspace. */
  async workspaceContext(route: RemoteWorkspaceRoute): Promise<RemoteWorkspaceContext> {
    let pending = this.contexts.get(route.workspace.id)
    if (pending === undefined) {
      pending = this.createWorkspaceContext(route)
      this.contexts.set(route.workspace.id, pending)
      void pending.catch(() => {
        if (this.contexts.get(route.workspace.id) === pending) this.contexts.delete(route.workspace.id)
      })
    }
    return pending
  }

  /** Resolve the SSH executable/options shared by all channels for this host. */
  sshTransport(route: RemoteWorkspaceRoute): RemoteSshTransport {
    return this.transportFor(route.server)
  }

  /** Open the UI-neutral Host protocol over one persistent SSH forward. */
  async connectBackend(server: RemoteSshServer): Promise<RemoteDshHostConnection> {
    const key = backendRuntimeKey(server)
    let pending = this.backendTunnels.get(key)
    if (pending !== undefined) {
      const existing = await pending.catch(() => undefined)
      if (existing?.alive === true) {
        if (!existing.connected) {
          this.publishBackendProgress(server, { stage: 'reconnecting' })
          await existing.ready()
        }
        this.publishBackendProgress(server, { stage: 'ready' })
        return existing
      }
      if (existing !== undefined) await existing.dispose()
      this.backendTunnels.delete(key)
    }
    const transport = this.transportFor(server)
    this.publishBackendProgress(server, { stage: 'connecting' })
    pending = RemoteDshHostConnection.open({
      sshExecutable: transport.executable,
      sshArgs: transport.args,
      sshTarget: server.sshTarget,
      remotePort: server.backendPort ?? DEFAULT_DSH_BACKEND_PORT,
      startupTimeoutMs: this.current.startupTimeoutMs,
      onProgress: progress => { this.publishBackendProgress(server, progress) },
    })
    pending = pending.then(tunnel => {
      this.publishBackendProgress(server, { stage: 'ready' })
      return tunnel
    }, error => {
      this.publishBackendProgress(server, {
        stage: 'failed',
        error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
      })
      throw error
    })
    this.backendTunnels.set(key, pending)
    void pending.catch(() => { if (this.backendTunnels.get(key) === pending) this.backendTunnels.delete(key) })
    return pending
  }

  /** Observe one Host installation/attachment without requiring the Host to exist yet. */
  watchBackendProgress(
    server: RemoteSshServer,
    listener: (progress: BackendConnectionProgress) => void,
  ): () => void {
    const key = backendRuntimeKey(server)
    let listeners = this.backendProgressListeners.get(key)
    if (listeners === undefined) {
      listeners = new Set()
      this.backendProgressListeners.set(key, listeners)
    }
    listeners.add(listener)
    const current = this.backendProgress.get(key)
    if (current !== undefined) listener(current)
    return () => {
      listeners?.delete(listener)
      if (listeners?.size === 0) this.backendProgressListeners.delete(key)
    }
  }

  private publishBackendProgress(server: RemoteSshServer, progress: BackendConnectionProgress): void {
    const key = backendRuntimeKey(server)
    this.backendProgress.set(key, progress)
    for (const listener of this.backendProgressListeners.get(key) ?? []) {
      try { listener(progress) } catch {}
    }
  }

  /** Open a typed, UI-neutral client on the shared Host tunnel. */
  async connectBackendClient(server: RemoteSshServer): Promise<RemoteDshHostClient> {
    return new RemoteDshHostClient(await this.connectBackend(server), this.current.requestTimeoutMs)
  }

  /** Serve the local Web assets while proxying the unchanged Host protocol. */
  async connectWebBackend(server: RemoteSshServer, localUiPort: number): Promise<RemoteDshWebProxy> {
    const key = webBackendRuntimeKey(server, localUiPort)
    let pending = this.webProxies.get(key)
    if (pending !== undefined) {
      const existing = await pending.catch(() => undefined)
      if (existing?.alive === true) return existing
      if (existing !== undefined) await existing.dispose()
      this.webProxies.delete(key)
    }
    const tunnel = await this.connectBackend(server)
    pending = RemoteDshWebProxy.attach(tunnel, localUiPort)
    this.webProxies.set(key, pending)
    void pending.catch(() => { if (this.webProxies.get(key) === pending) this.webProxies.delete(key) })
    return pending
  }

  /** AHP-backed shell view sharing the host runtime but retaining workspace path mapping. */
  async workspaceShell(route: RemoteWorkspaceRoute, dialect: 'bash' | 'pwsh'): Promise<ShellExecutor> {
    const key = `${route.workspace.id}:${dialect}`
    let pending = this.shellContexts.get(key)
    if (pending === undefined) {
      pending = this.createWorkspaceShellContext(route, dialect)
      this.shellContexts.set(key, pending)
      void pending.catch(() => {
        if (this.shellContexts.get(key) === pending) this.shellContexts.delete(key)
      })
    }
    return (await pending).shell
  }

  private queueRefresh(config: ResolvedConfig): Promise<void> {
    const run = this.refreshTail.then(() => this.publish(config))
    this.refreshTail = run.then(() => {}, () => {})
    return run
  }

  private async publish(config: ResolvedConfig): Promise<void> {
    this.validate(config)
    await mkdir(resolve(tmpdir(), 'dsh-ssh'), { recursive: true })
    const servers = new Map(config.servers.map(server => [server.id, server]))
    const nextRoutes = new Map<string, RemoteWorkspaceRoute>()
    const nextById = new Map<string, RemoteWorkspaceRoute>()
    for (const workspace of config.workspaces) {
      const server = servers.get(workspace.serverId) as RemoteSshServer
      const aliasPath = resolve(workspace.aliasPath ?? resolve(config.aliasRoot, workspace.id))
      await mkdir(aliasPath, { recursive: true })
      const canonicalAlias = resolve(aliasPath)
      const route: RemoteWorkspaceRoute = {
        kind: 'remote', server, workspace, aliasPath: canonicalAlias,
        mapper: new WorkspacePathMapper(canonicalAlias, workspace.remotePath),
      }
      nextRoutes.set(normalizeLocal(canonicalAlias), route)
      nextById.set(workspace.id, route)
      this.remoteAliases.add(normalizeLocal(canonicalAlias))
    }
    for (const [id, pending] of this.contexts) {
      const previous = this.routeByWorkspaceId.get(id)
      const next = nextById.get(id)
      if (previous === undefined || next === undefined || routeRuntimeKey(previous) !== routeRuntimeKey(next)) {
        const settled = await Promise.resolve(pending).catch(() => undefined)
        if (settled !== undefined) await settled.ctx.fiber.dispose()
        this.contexts.delete(id)
      }
    }
    for (const [key, pending] of this.shellContexts) {
      const id = key.slice(0, key.lastIndexOf(':'))
      const previous = this.routeByWorkspaceId.get(id)
      const next = nextById.get(id)
      if (previous === undefined || next === undefined || routeRuntimeKey(previous) !== routeRuntimeKey(next)) {
        const settled = await Promise.resolve(pending).catch(() => undefined)
        if (settled !== undefined) await settled.ctx.fiber.dispose()
        this.shellContexts.delete(key)
      }
    }
    for (const [id, pending] of this.hosts) {
      const next = servers.get(id)
      const settled = await Promise.resolve(pending).catch(() => undefined)
      if (next === undefined || settled === undefined || settled.key !== serverRuntimeKey(next)) {
        if (settled !== undefined) await this.disposeHost(settled)
        this.hosts.delete(id)
      }
    }
    for (const [key, pending] of this.webProxies) {
      const [serverId, expectedRuntimeKey] = JSON.parse(key) as [string, string, number]
      const next = servers.get(serverId)
      if (next === undefined || serverRuntimeKey(next) !== expectedRuntimeKey) {
        const settled = await Promise.resolve(pending).catch(() => undefined)
        if (settled !== undefined) await settled.dispose()
        this.webProxies.delete(key)
      }
    }
    for (const [key, pending] of this.backendTunnels) {
      const [serverId, expectedRuntimeKey] = JSON.parse(key) as [string, string]
      const next = servers.get(serverId)
      if (next === undefined || serverRuntimeKey(next) !== expectedRuntimeKey) {
        const settled = await Promise.resolve(pending).catch(() => undefined)
        if (settled !== undefined) await settled.dispose()
        this.backendTunnels.delete(key)
      }
    }
    this.routes.clear()
    this.routeByWorkspaceId.clear()
    for (const [key, value] of nextRoutes) this.routes.set(key, value)
    for (const [key, value] of nextById) this.routeByWorkspaceId.set(key, value)
    this.current = structuredClone(config)
    await this.registerAllWorkspaces()
  }

  private async registerAllWorkspaces(): Promise<void> {
    const registry = this.workspaceRegistry
    if (registry === undefined) return
    for (const route of this.routeByWorkspaceId.values()) {
      const title = route.workspace.title
        ?? `${route.server.label} > ${posix.basename(route.workspace.remotePath) || route.workspace.remotePath}`
      const workspace = await registry.create(route.aliasPath, title)
      if (workspace.title !== title) await workspace.setTitle(title)
    }
  }

  private findAlias(path: string): RemoteWorkspaceRoute | undefined {
    const absolute = normalizeLocal(resolve(path))
    let best: RemoteWorkspaceRoute | undefined
    for (const [alias, route] of this.routes) {
      if (!isContained(alias, absolute)) continue
      if (best === undefined || alias.length > normalizeLocal(best.aliasPath).length) best = route
    }
    return best
  }

  private findRemotePath(path: string): RemoteWorkspaceRoute | undefined {
    if (!posix.isAbsolute(path) || /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\')) return undefined
    const normalized = posix.normalize(path)
    let best: RemoteWorkspaceRoute | undefined
    let bestLength = -1
    for (const route of this.routeByWorkspaceId.values()) {
      const root = posix.normalize(route.workspace.remotePath)
      const rel = posix.relative(root, normalized)
      if (rel !== '' && (rel === '..' || rel.startsWith('../') || posix.isAbsolute(rel))) continue
      if (root.length > bestLength) {
        best = route
        bestLength = root.length
      } else if (root.length === bestLength && best?.workspace.id !== route.workspace.id) {
        throw new Error(`dsh-ssh-control: remote path matches multiple workspaces: ${path}`)
      }
    }
    return best
  }

  private wasRemoteAlias(path: string): boolean {
    const absolute = normalizeLocal(resolve(path))
    return [...this.remoteAliases].some(alias => isContained(alias, absolute))
  }

  private async createWorkspaceContext(route: RemoteWorkspaceRoute): Promise<RemoteWorkspaceContext> {
    const host = await this.hostContext(route.server)
    const child = new Context()
    try {
      child.provide('remoteSsh', host.remote)
      await child.plugin(RemoteSshFileSystem, {
        remoteWorkspace: route.workspace.remotePath,
        localWorkspace: route.aliasPath,
      })
      return { ctx: child, fs: child.fs, remote: host.remote }
    } catch (error) {
      await child.fiber.dispose().catch(() => {})
      throw error
    }
  }

  private async hostContext(server: RemoteSshServer): Promise<RemoteHostContext> {
    let pending = this.hosts.get(server.id)
    if (pending === undefined) {
      pending = this.createHostContext(server)
      this.hosts.set(server.id, pending)
      void pending.catch(() => {
        if (this.hosts.get(server.id) === pending) this.hosts.delete(server.id)
      })
    }
    return pending
  }

  private async createWorkspaceShellContext(route: RemoteWorkspaceRoute, dialect: 'bash' | 'pwsh'): Promise<RemoteWorkspaceShellContext> {
    const host = await this.hostContext(route.server)
    const child = new Context()
    try {
      child.provide('remoteSsh', host.remote)
      await child.plugin(RemoteSshShellExecutor, {
        localWorkspace: route.aliasPath,
        remoteWorkspace: route.workspace.remotePath,
        shellCommand: dialect,
      })
      return { ctx: child, shell: child.shell, remote: host.remote }
    } catch (error) {
      await child.fiber.dispose().catch(() => {})
      throw error
    }
  }

  private async createHostContext(server: RemoteSshServer): Promise<RemoteHostContext> {
    const child = new Context()
    const transport = this.transportFor(server)
    try {
      await child.plugin(RemoteSshRuntime, {
        sshTarget: server.sshTarget,
        sshExecutable: transport.executable,
        sshArgs: transport.args,
        remoteCodeCommand: server.remoteCodeCommand ?? 'code',
        remoteAccessRoot: '/',
        startupTimeoutMs: this.current.startupTimeoutMs,
        requestTimeoutMs: this.current.requestTimeoutMs,
      })
      return { ctx: child, remote: child.remoteSsh, key: serverRuntimeKey(server), server, transport }
    } catch (error) {
      await child.fiber.dispose().catch(() => {})
      throw error
    }
  }

  private transportFor(server: RemoteSshServer): RemoteSshTransport {
    let executable = server.sshExecutable ?? 'ssh'
    let multiplexed = process.platform !== 'win32'
    // Both Windows OpenSSH and Git-for-Windows accepted ControlMaster syntax
    // in local probes but reset every multiplexed session. Do not enable a
    // transport that silently reconnects and contaminates remote stderr.
    if (process.platform === 'win32') multiplexed = false
    const args = [...(server.sshArgs ?? [])]
    if (multiplexed) {
      // Include the local process id: a crashed/closed DSH instance may leave a
      // short-lived ControlPersist socket, and a new instance must never bind
      // to that stale master. All workspaces in this process still share it.
      const digest = createHash('sha256').update(`${process.pid}:${serverRuntimeKey(server)}`).digest('hex').slice(0, 16)
      const controlPath = resolve(tmpdir(), 'dsh-ssh', digest).replaceAll('\\', '/')
      args.push('-o', 'ControlMaster=auto', '-o', 'ControlPersist=60', '-o', `ControlPath=${controlPath}`)
    }
    return { executable, args, multiplexed }
  }

  private async disposeHost(host: RemoteHostContext): Promise<void> {
    await host.ctx.fiber.dispose()
    if (!host.transport.multiplexed) return
    await closeControlMaster(host.transport, host.server.sshTarget)
  }

  private async replaceSettings(next: ResolvedConfig): Promise<void> {
    if (this.settings === undefined) throw new Error('dsh-ssh-control: settings service is unavailable')
    await this.settings.replace(next)
    await this.refreshTail
  }

  private validate(config: ResolvedConfig): void {
    if (!isAbsolute(config.aliasRoot)) throw new Error('dsh-ssh-control: aliasRoot must be an absolute local path')
    if (config.sshConfigFile !== undefined && !isAbsolute(config.sshConfigFile)) throw new Error('dsh-ssh-control: sshConfigFile must be an absolute path')
    if (config.openFileEditorPath !== undefined && !isAbsolute(config.openFileEditorPath)) throw new Error('dsh-ssh-control: openFileEditorPath must be an absolute path')
    if (config.openFileMode === 'custom' && config.openFileEditorPath === undefined) throw new Error('dsh-ssh-control: custom openFileMode requires openFileEditorPath')
    if (!Number.isSafeInteger(config.openFileDownloadMaxBytes) || config.openFileDownloadMaxBytes <= 0) throw new Error('dsh-ssh-control: openFileDownloadMaxBytes must be a positive integer')
    if (!Number.isSafeInteger(config.startupTimeoutMs) || config.startupTimeoutMs <= 0) throw new Error('dsh-ssh-control: startupTimeoutMs must be a positive integer')
    if (!Number.isSafeInteger(config.requestTimeoutMs) || config.requestTimeoutMs <= 0) throw new Error('dsh-ssh-control: requestTimeoutMs must be a positive integer')
    if (config.defaultServerId !== undefined && config.defaultServerId.trim().length === 0) {
      delete config.defaultServerId
    }
    const serverIds = new Set<string>()
    for (const server of config.servers) {
      if (!ID_PATTERN.test(server.id) || serverIds.has(server.id)) throw new Error(`dsh-ssh-control: invalid or duplicate server id '${server.id}'`)
      if (server.label.trim().length === 0 || server.sshTarget.trim().length === 0) throw new Error(`dsh-ssh-control: server '${server.id}' requires label and sshTarget`)
      if (server.sshExecutable !== undefined && server.sshExecutable.trim().length === 0) throw new Error(`dsh-ssh-control: server '${server.id}' sshExecutable must be non-empty`)
      if (server.backendPort !== undefined && (!Number.isSafeInteger(server.backendPort) || server.backendPort < 0 || server.backendPort > 65535)) {
        throw new Error(`dsh-ssh-control: server '${server.id}' backendPort must be between 0 and 65535`)
      }
      serverIds.add(server.id)
    }
    const workspaceIds = new Set<string>()
    const aliases = new Set<string>()
    for (const workspace of config.workspaces) {
      if (!ID_PATTERN.test(workspace.id) || workspaceIds.has(workspace.id)) throw new Error(`dsh-ssh-control: invalid or duplicate workspace id '${workspace.id}'`)
      if (!serverIds.has(workspace.serverId)) throw new Error(`dsh-ssh-control: workspace '${workspace.id}' refers to unknown server '${workspace.serverId}'`)
      if (!posix.isAbsolute(workspace.remotePath)) throw new Error(`dsh-ssh-control: workspace '${workspace.id}' remotePath must be an absolute POSIX path`)
      if (workspace.title !== undefined && workspace.title.trim().length === 0) throw new Error(`dsh-ssh-control: workspace '${workspace.id}' title must be non-empty`)
      const alias = normalizeLocal(resolve(workspace.aliasPath ?? resolve(config.aliasRoot, workspace.id)))
      if (aliases.has(alias)) throw new Error(`dsh-ssh-control: duplicate workspace alias '${alias}'`)
      aliases.add(alias)
      workspaceIds.add(workspace.id)
    }
  }
}

function serverRuntimeKey(server: RemoteSshServer): string {
  return JSON.stringify([server.sshTarget, server.sshArgs ?? [], server.remoteCodeCommand ?? 'code', server.sshExecutable ?? null, server.backendPort ?? DEFAULT_DSH_BACKEND_PORT])
}

function backendRuntimeKey(server: RemoteSshServer): string {
  return JSON.stringify([server.id, serverRuntimeKey(server)])
}

function webBackendRuntimeKey(server: RemoteSshServer, localUiPort: number): string {
  return JSON.stringify([server.id, serverRuntimeKey(server), localUiPort])
}

function routeRuntimeKey(route: RemoteWorkspaceRoute): string {
  return JSON.stringify([serverRuntimeKey(route.server), route.workspace.remotePath, normalizeLocal(route.aliasPath)])
}

async function closeControlMaster(transport: RemoteSshTransport, target: string): Promise<void> {
  await new Promise<void>(resolvePromise => {
    const child = spawn(transport.executable, [...transport.args, '-O', 'exit', target], {
      windowsHide: true,
      stdio: 'ignore',
    })
    const timer = setTimeout(() => { child.kill(); resolvePromise() }, 3_000)
    child.once('error', () => { clearTimeout(timer); resolvePromise() })
    child.once('close', () => { clearTimeout(timer); resolvePromise() })
  })
}

function normalizeLocal(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

function isContained(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

export default RemoteSshManager
