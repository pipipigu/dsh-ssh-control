import { Context, Service } from "@deepseek-ai/cordis";
//#region src/routing/manager.d.ts
interface RemoteSshServer {
  id: string;
  label: string;
  sshTarget: string;
  sshArgs?: string[] | undefined;
  source?: string | undefined;
  hostName?: string | undefined;
  user?: string | undefined;
  port?: number | undefined;
  configPath?: string | undefined;
}
interface Config {
  sshConfigFile?: string | undefined;
  servers?: RemoteSshServer[] | undefined;
  defaultServerId?: string | undefined;
}
interface DiscoveredServer extends RemoteSshServer {
  source: 'config' | 'settings';
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    remoteSshManager: RemoteSshManager;
  }
}
declare class RemoteSshManager extends Service {
  static readonly inject: string[];
  private readonly configScope;
  private config;
  private discoveredHosts;
  private attachedSessions;
  readonly initialRefresh: Promise<void>;
  constructor(ctx: Context, initialConfig?: Config);
  refresh(): Promise<void>;
  listAvailableServers(): Promise<DiscoveredServer[]>;
  sessionStatus(sessionId: string): {
    sessionId: string;
    executionWorld: string;
    server?: RemoteSshServer;
    status: string;
  };
  attachSession(sessionId: string, opts?: {
    server?: string;
  }): Promise<any>;
  detachSession(sessionId: string): Promise<any>;
  updateUserPreferences(prefs: {
    sshConfigFile?: string;
  }): Promise<void>;
  snapshot(): Config;
}
declare function apply(ctx: Context, config?: Config): void;
//#endregion
export { Config, DiscoveredServer, RemoteSshManager, RemoteSshServer, apply, apply as default };