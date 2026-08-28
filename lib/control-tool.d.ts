import { Context } from "@deepseek-ai/cordis";
//#region src/routing/control-tool.d.ts
declare const name = "dsh-ssh-control-control-tool";
declare const inject: string[];
declare function apply(ctx: Context): void;
//#endregion
export { apply, inject, name };