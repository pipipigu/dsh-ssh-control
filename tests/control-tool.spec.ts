import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { RemoteSshManager } from '../src/routing/manager.ts'
import { apply as applyControlTool } from '../src/routing/control-tool.ts'
import { decodeOutputBuffer, parseDiskUsage, parseDockerList } from '../src/ssh/runner.ts'

describe('ssh_control unified tool suite', () => {
  it('handles smart multi-encoding self-healing (UTF-8 & GBK)', () => {
    // 1. UTF-8 standard text
    const utf8Buf = Buffer.from('你好，DeepSeek Harness 远程中枢', 'utf8')
    expect(decodeOutputBuffer(utf8Buf)).toBe('你好，DeepSeek Harness 远程中枢')

    // 2. GBK Windows encoded text
    const gbkEncoder = new TextDecoder('gbk')
    // Encode '系统运行正常' into GBK using Buffer/iconv mapping simulation
    // GBK representation for '中国': 0xd6 0xd0 0xb9 0xfa
    const gbkBuf = Buffer.from([0xd6, 0xd0, 0xb9, 0xfa])
    expect(decodeOutputBuffer(gbkBuf)).toBe('中国')
  })

  it('parses df -h disk outputs into structured mounts', () => {
    const sampleDf = `Filesystem      Size  Used Avail Use% Mounted on
udev            3.8G     0  3.8G   0% /dev
tmpfs           770M  1.9M  768M   1% /run
/dev/sda1        50G   18G   30G  38% /
/dev/sdb1       2.0T  850G  1.1T  44% /volume1
tmpfs           3.8G     0  3.8G   0% /dev/shm`

    const disks = parseDiskUsage(sampleDf)
    expect(disks.length).toBe(5)
    expect(disks[2]).toMatchObject({
      filesystem: '/dev/sda1',
      size: '50G',
      used: '18G',
      available: '30G',
      percent: '38%',
      mount: '/',
    })
    expect(disks[3]).toMatchObject({
      mount: '/volume1',
      percent: '44%',
    })
  })

  it('parses docker container JSON formatted lists', () => {
    const sampleDocker = `{"ID":"a1b2c3d4e5f6","Names":"model-gateway","Image":"pi-ai/gateway:latest","Status":"Up 3 weeks","State":"running","Ports":"0.0.0.0:8000->8000/tcp","CreatedAt":"2026-08-01"}
{"ID":"f6e5d4c3b2a1","Names":"home-assistant","Image":"ghcr.io/home-assistant:stable","Status":"Up 22 days","State":"running","Ports":"0.0.0.0:8123->8123/tcp","CreatedAt":"2026-08-05"}`

    const containers = parseDockerList(sampleDocker)
    expect(containers.length).toBe(2)
    expect(containers[0]).toMatchObject({
      id: 'a1b2c3d4e5f6',
      names: 'model-gateway',
      state: 'running',
    })
    expect(containers[1]?.names).toBe('home-assistant')
  })

  it('registers ssh_control and supports all hub actions', async () => {
    const ctx = new Context()
    const settings = {
      register: (_ns: string, _schema: unknown, options: { base: any }) => {
        let current = options.base
        return {
          get: () => current,
          replace: async (next: any) => { current = next },
          watch: () => () => {},
        }
      },
    }
    ctx.provide('settings', settings as never)
    ctx.provide('workspaceRegistry', {
      create: async (path: string, title: string) => ({ path, title, setTitle: async () => {} }),
    } as never)

    const manager = new RemoteSshManager(ctx, {
      aliasRoot: '/tmp/test-workspaces',
      servers: [
        { id: 'nas-01', label: 'NAS Server', sshTarget: 'raydrive-nas' },
        { id: 'deploy-01', label: 'Deploy Server', sshTarget: '192.168.31.121' },
      ],
      workspaces: [
        { id: 'nas-ws-1', serverId: 'nas-01', remotePath: '/srv/project', aliasPath: '/tmp/test-workspaces/nas-ws-1' },
      ],
      defaultServerId: 'nas-01',
      autoConnect: false,
    })
    await (manager as any).initialRefresh

    new SystemPrompt(ctx, { persona: 'Working in {{cwd}}' })
    new ToolRuntime(ctx)
    applyControlTool(ctx)

    const tool = ctx.tools.get('ssh_control')
    expect(tool).toBeDefined()
    expect(tool?.name).toBe('ssh_control')

    // 1. Test action: 'list'
    const listResult: any = await tool?.execute({ action: 'list' }, {
      callId: 'call-1' as never,
      name: 'ssh_control',
      arguments: { action: 'list' },
      signal: new AbortController().signal,
      token: 'tok-1' as never,
      rootCallId: 'call-1' as never,
    } as never)
    expect(listResult).toBeDefined()
    expect(listResult.count).toBeGreaterThanOrEqual(2)

    // 2. Test action: 'tunnel' list
    const tunnelListResult: any = await tool?.execute({ action: 'tunnel', tunnelAction: 'list' }, {
      callId: 'call-2' as never,
      name: 'ssh_control',
      arguments: { action: 'tunnel', tunnelAction: 'list' },
      signal: new AbortController().signal,
      token: 'tok-2' as never,
      rootCallId: 'call-2' as never,
    } as never)
    expect(tunnelListResult).toMatchObject({
      count: expect.any(Number),
      tunnels: expect.any(Array),
    })

    // 3. Test action: 'status' before attach (default session)
    const initialStatus: any = await tool?.execute({ action: 'status' }, {
      callId: 'call-3' as never,
      name: 'ssh_control',
      arguments: { action: 'status' },
      signal: new AbortController().signal,
      token: 'tok-3' as never,
      rootCallId: 'call-3' as never,
    } as never)
    expect(initialStatus).toBeDefined()
    expect(initialStatus.executionWorld).toBe('local')

    // 4. Test action: 'attach'
    const attachResult: any = await tool?.execute({ action: 'attach', server: 'nas-01', path: '/srv/project' }, {
      callId: 'call-4' as never,
      name: 'ssh_control',
      arguments: { action: 'attach', server: 'nas-01', path: '/srv/project' },
      signal: new AbortController().signal,
      token: 'tok-4' as never,
      rootCallId: 'call-4' as never,
    } as never)
    expect(attachResult).toMatchObject({
      status: 'attached',
      serverId: 'nas-01',
      remotePath: '/srv/project',
    })

    // 5. Test action: 'detach'
    const detachResult: any = await tool?.execute({ action: 'detach' }, {
      callId: 'call-5' as never,
      name: 'ssh_control',
      arguments: { action: 'detach' },
      signal: new AbortController().signal,
      token: 'tok-5' as never,
      rootCallId: 'call-5' as never,
    } as never)
    expect(detachResult).toMatchObject({
      status: 'detached',
      message: expect.stringContaining('local'),
    })

    // 6. Test action: 'forward'
    const forwardResult: any = await tool?.execute({ action: 'forward', port: 8080, targetPort: 80 }, {
      callId: 'call-6' as never,
      name: 'ssh_control',
      arguments: { action: 'forward', port: 8080, targetPort: 80 },
      signal: new AbortController().signal,
      token: 'tok-6' as never,
      rootCallId: 'call-6' as never,
    } as never)
    expect(forwardResult).toMatchObject({
      status: 'forward_info',
      port: 8080,
      targetPort: 80,
    })

    await ctx.fiber.dispose()
  })
})
