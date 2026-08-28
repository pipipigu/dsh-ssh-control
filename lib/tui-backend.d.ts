import { i as RemoteDshHostClient } from "./client-BRvjWg_X.js";
import { l as RemoteSshManager, u as RemoteSshServer } from "./manager-Bxqbyjl_.js";
import { Context } from "@deepseek-ai/cordis";
import { IApiClient } from "@deepseek-ai/dsh-host-apiproxy/client";
import { WorkspaceView } from "@deepseek-ai/dsh-host-apiproxy/api";
import { TuiBackendAdapter, TuiBackendCommandRequest, TuiBackendHost, TuiBackendProvider } from "@deepseek-harness-tui/dsh-tui/backends";
//#region src/tui/backend-controller.d.ts
interface RemoteTuiChannelAttachment {
  channel: object;
  handleCommand?(request: TuiBackendCommandRequest): boolean;
  dispose(): void | Promise<void>;
}
interface RemoteTuiChannelFactoryRequest {
  api: IApiClient;
  client: RemoteDshHostClient;
  server: RemoteSshServer;
  workspace: WorkspaceView;
  host: TuiBackendHost;
}
interface RemoteTuiChannelFactory {
  attach(request: RemoteTuiChannelFactoryRequest): Promise<RemoteTuiChannelAttachment>;
}
/** Owns TUI backend identity independently from transparent workspace routing. */
declare class RemoteSshTuiBackendController implements TuiBackendProvider {
  private readonly manager;
  readonly id = "dsh-ssh-control";
  private host;
  private localSurfaceChannel;
  private switched;
  private factory;
  private attachment;
  private readonly clients;
  private readonly targets;
  constructor(manager: RemoteSshManager);
  registerFactory(factory: RemoteTuiChannelFactory): () => void;
  attach(host: TuiBackendHost): TuiBackendAdapter;
  private handleCommand;
  connect(request: TuiBackendCommandRequest): Promise<boolean>;
  disconnect(): Promise<void>;
  dispose(): Promise<void>;
  private detach;
  private directoryChoices;
  private targetFor;
  private activateTarget;
  private clientFor;
  private openClient;
}
//#endregion
//#region src/profiles/tui-backend.d.ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    remoteSshTuiBackend: RemoteSshTuiBackendController;
  }
}
declare const name = "dsh-ssh-control-tui-backend";
declare const inject: string[];
/** Observe dsh-tui's optional registry without making it a profile dependency. */
declare function apply(ctx: Context): void;
//#endregion
export { apply, apply as default, inject, name };