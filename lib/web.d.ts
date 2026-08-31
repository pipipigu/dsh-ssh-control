import { Context } from "@deepseek-ai/cordis";
//#region src/profiles/web.d.ts
declare const ROUTE_PREFIX = "/plugins/@dsh-external/dsh-ssh-control";
declare const REMOTE_SSH_STATE_PATH = "/plugins/@dsh-external/dsh-ssh-control/state";
declare const REMOTE_SSH_PROBE_PATH = "/plugins/@dsh-external/dsh-ssh-control/probe";
declare const REMOTE_SSH_CONFIG_HOST_PATH = "/plugins/@dsh-external/dsh-ssh-control/ssh-config/host";
declare const REMOTE_SSH_SETTINGS_PATH = "/plugins/@dsh-external/dsh-ssh-control/settings";
declare const name = "dsh-ssh-control-web";
declare const inject: string[];
/** Activate the Web surface only in compositions that provide a Web host. */
declare function apply(ctx: Context): void;
//#endregion
export { REMOTE_SSH_CONFIG_HOST_PATH, REMOTE_SSH_PROBE_PATH, REMOTE_SSH_SETTINGS_PATH, REMOTE_SSH_STATE_PATH, ROUTE_PREFIX, apply, inject, name };