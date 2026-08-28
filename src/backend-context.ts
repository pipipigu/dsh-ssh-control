/** Same-origin signal exposed only by a Web window attached to a remote Host. */
export const REMOTE_BACKEND_CONTEXT_PATH = '/dsh-ssh-control/backend-context'

/**
 * Local control-plane endpoints hidden inside a remote Backend window. Keep
 * this exact: the browser bundle may itself be served below `/plugins/`.
 */
export const REMOTE_SSH_LOCAL_CONTROL_PATHS = new Set([
  '/plugins/@dsh-external/dsh-ssh-control/state',
  '/plugins/@dsh-external/dsh-ssh-control/workspace',
  '/plugins/@dsh-external/dsh-ssh-control/workspace/remove',
  '/plugins/@dsh-external/dsh-ssh-control/local-workspace',
  '/plugins/@dsh-external/dsh-ssh-control/probe',
  '/plugins/@dsh-external/dsh-ssh-control/ssh-config/host',
  '/plugins/@dsh-external/dsh-ssh-control/settings',
  '/plugins/@dsh-external/dsh-ssh-control/directory',
  '/plugins/@dsh-external/dsh-ssh-control/open-file',
  '/plugins/@dsh-external/dsh-ssh-control/backend/connect',
])

export interface RemoteBackendContext {
  attached: true
  transport: 'ssh'
}
