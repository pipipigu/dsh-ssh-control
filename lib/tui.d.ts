import { l as RemoteSshManager, m as RemoteWorkspaceRoute, u as RemoteSshServer } from "./manager-Bxqbyjl_.js";
import { Context } from "@deepseek-ai/cordis";
import { TuiWorkspaceCommand, TuiWorkspaceTarget } from "@deepseek-harness-tui/dsh-tui/workspaces";
//#region src/tui/servers.d.ts
/** Merge saved servers with concrete hosts discovered from OpenSSH config. */
declare function listAvailableServers(manager: RemoteSshManager): Promise<RemoteSshServer[]>;
//#endregion
//#region src/profiles/tui.d.ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    remoteSshTui: object;
  }
}
interface ParsedSshWorkspaceUri {
  selector: string;
  sshTarget: string;
  remotePath: string;
  port?: number;
}
declare const name = "dsh-ssh-control-tui";
declare const inject: string[];
/** Activate the terminal adapter only when a workspace registry is present. */
declare function apply(ctx: Context): void;
/** Interactive device and directory browser contributed as `/workspace remote`. */
declare function remoteWorkspaceCommand(manager: RemoteSshManager): TuiWorkspaceCommand;
/** Resolve an existing server/workspace or persist a URI-addressed target. */
declare function resolveSshWorkspaceUri(manager: RemoteSshManager, uri: string): Promise<TuiWorkspaceTarget | undefined>;
/** Resolve a POSIX path relative to the currently selected SSH workspace. */
declare function resolveSshWorkspacePath(manager: RemoteSshManager, path: string, cwd: string): Promise<TuiWorkspaceTarget | undefined>;
/** Parse `ssh://[user@]server[:port]/absolute/path`. */
declare function parseSshWorkspaceUri(uri: string): ParsedSshWorkspaceUri | undefined;
declare function sshWorkspaceUri(route: RemoteWorkspaceRoute): string;
//#endregion
export { ParsedSshWorkspaceUri, apply, apply as default, inject, listAvailableServers, name, parseSshWorkspaceUri, remoteWorkspaceCommand, resolveSshWorkspacePath, resolveSshWorkspaceUri, sshWorkspaceUri };