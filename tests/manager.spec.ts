import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import RemoteSshManager from '../src/routing/manager.ts'
import { describe, expect, it } from 'vitest'

class MemorySettings extends SettingsProvider {
  private storedDocument: Record<string, unknown> = {}

  get writable(): boolean { return true }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.storedDocument))
  }

  protected persist(namespace: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.storedDocument = { ...this.storedDocument, [namespace]: structuredClone(section) }
    return Promise.resolve()
  }
}

async function createContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(MemorySettings).await()
  return ctx
}

describe('RemoteSshManager', () => {
  it('discovers OpenSSH and settings configured servers', async () => {
    const ctx = await createContext()
    await ctx.plugin(RemoteSshManager, {
      servers: [
        { id: 'nas-01', label: 'NAS Server', sshTarget: 'nas.internal' },
        { id: 'app-01', label: 'App Server', sshTarget: '10.0.0.12' },
      ],
      defaultServerId: 'nas-01',
    })

    const manager = ctx.remoteSshManager
    const servers = await manager.listAvailableServers()
    expect(servers.length).toBeGreaterThanOrEqual(2)
    const nas = servers.find(s => s.id === 'nas-01')
    expect(nas).toMatchObject({
      label: 'NAS Server',
      sshTarget: 'nas.internal',
      source: 'settings',
    })

    // Session status initially local
    const initStatus = manager.sessionStatus('sess-1')
    expect(initStatus.executionWorld).toBe('local')

    // Attach session
    const attachRes = await manager.attachSession('sess-1', { server: 'nas-01' })
    expect(attachRes.status).toBe('attached')
    expect(manager.sessionStatus('sess-1')).toMatchObject({
      executionWorld: 'remote',
      server: { id: 'nas-01' },
    })

    // Detach session
    const detachRes = await manager.detachSession('sess-1')
    expect(detachRes.status).toBe('detached')
    expect(manager.sessionStatus('sess-1').executionWorld).toBe('local')

    await ctx.fiber.dispose()
  })

  it('updates and persists user preferences', async () => {
    const ctx = await createContext()
    await ctx.plugin(RemoteSshManager, {
      sshConfigFile: '/etc/ssh/ssh_config',
    })

    const manager = ctx.remoteSshManager
    expect(manager.snapshot().sshConfigFile).toBe('/etc/ssh/ssh_config')

    await manager.updateUserPreferences({
      sshConfigFile: '/home/user/.ssh/custom_config',
    })
    expect(manager.snapshot().sshConfigFile).toBe('/home/user/.ssh/custom_config')

    await ctx.fiber.dispose()
  })
})
