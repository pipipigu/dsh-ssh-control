import type {} from '@deepseek-ai/cordis'

declare module '@deepseek-harness-tui/dsh-tui/backends' {
  export interface TuiBackendCommandRequest {
    name: string
    channel: any
    [key: string]: any
  }
  export interface TuiBackendHost {
    channel: any
    [key: string]: any
  }
  export interface TuiBackendAdapter {
    channel: any
    handleCommand?: (request: any) => boolean
    dispose: () => void | Promise<void>
  }
  export interface TuiBackendProvider {
    readonly id: string
    attach: (host: any) => any
  }
}

declare module '@deepseek-harness-tui/dsh-tui/workspaces' {
  export interface TuiWorkspaceChoice {
    id?: string
    label?: string
    description?: string
    badge?: string
    choose?: (signal?: any, progress?: any) => any
    input?: {
      initialValue?: string
      placeholder?: string
      submit?: (value: any, signal?: any, progress?: any) => any
      [key: string]: any
    }
    value?: string
    [key: string]: any
  }
  export interface TuiWorkspaceCommandResult {
    [key: string]: any
  }
  export interface TuiWorkspaceCommand {
    name?: string
    aliases?: string[]
    description?: string
    run?: (input: string, context?: any) => Promise<TuiWorkspaceCommandResult>
    [key: string]: any
  }
  export interface TuiWorkspaceProvider {
    schemes?: string[]
    list?: () => any[]
    resolve?: (uri: string) => any
    resolvePath?: (path: string, cwd?: string) => any
    describe?: (cwd: string) => any
    rename?: (cwd: string, title: string) => Promise<any>
    commands?: any[]
    commandShell?: (cwd: string) => Promise<any>
    [key: string]: any
  }
  export interface TuiWorkspaceRuntime {
    register: (provider: TuiWorkspaceProvider) => any
    [key: string]: any
  }
  export interface TuiWorkspaceProgress {
    [key: string]: any
  }
  export interface TuiWorkspaceTarget {
    [key: string]: any
  }
}

declare module '@deepseek-harness-tui/dsh-tui/channel' {
  export interface NotificationItem {
    [key: string]: any
  }
  export interface ChatRow {
    id?: number
    kind?: string
    streaming?: boolean
    time?: number
    tool?: any
    seq?: number
    text?: string
    [key: string]: any
  }
  export interface Channel {
    [key: string]: any
    version: number
    rows: ChatRow[]
    status: 'idle' | 'running' | 'disposed' | 'starting'
    sessionTitle: string
    agentId: string
    model: string
    provider: string
    tokens: { input: number; output: number }
    cwd: string
    displayCwd: string
    gitBranch?: string | undefined
    working: boolean
    spinnerMode?: any
    responseChars: number
    activeToolCount: number
    turnStart: number
    lastUserText: string
    notifications: NotificationItem[]
    contextWindow?: number | undefined
    reasoningEffort?: string | undefined
    lastUsage?: { input: number; output: number; cacheRead: number; cacheWrite: number } | undefined
    tps?: number | undefined
    tpsSamples: Array<{ tps: number; at: number }>
    workingActivity?: any
    activityFrames?: string | undefined
    activityEnabled: boolean
    contextBarEnabled: boolean
    goal?: any
    todos: any[]
    loadedContext?: any
    pending: any[]
    contextSegments?: any
    mode?: any
    commandList: any[]
    commandCompletions(input: string): any[]
    resolveWorkspace(reference: string): Promise<any>
    listWorkspaces(): Promise<any[]>
    listSessions(): Promise<any[]>
    listEfforts(): Promise<any>
    listPresets(): Promise<any>
    listModels(): Promise<any>
    open?(): Promise<void>
    dispose?(): void | Promise<void>
    handleBackendCommand?(command: any): any
    selectMode?(mode: any): any
    deleteSession?(id: string): any
    renameSession?(title: string): any
    savePlan?(text: string): any
    sendUserMessage?(text: string, images?: any[]): any
    interrupt?(): any
    setupProvider?(route: string, profile: any, credential?: any): any
  }
}

declare module '@deepseek-harness-tui/dsh-tui/provider-setup' {
  export interface ProviderSetupHost {
    listCustomProviders?(): Promise<any[]>
    routeExists?(route: string): Promise<boolean>
    discoverModels?(request: any): Promise<any>
    envShadows?(ref: string): Promise<boolean>
    readCredential?(ref: string): Promise<any>
    writeCredential?(ref: string, value: any): Promise<any>
    removeCredential?(ref: string): Promise<any>
    writeProfile?(route: string, profile: any): Promise<any>
    commitProvider?(request: any): Promise<any>
    [key: string]: any
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiBackends?: any
    tuiWorkspaces?: any
  }
}
