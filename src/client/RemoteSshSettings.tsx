import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import {
  CONFIG_HOST_PATH, emptyCatalog, PROBE_PATH, request, SETTINGS_PATH, STATE_PATH,
} from './api.ts'
import type { CatalogState } from './api.ts'
import { button, card, dim, page, primary, row, singleLineInput } from './styles.ts'
import { requireTranslate } from './types.ts'
import type { LocalizedProps } from './types.ts'
import {
  ActivityIcon,
  AlertCircleIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  PlusIcon,
  RefreshIcon,
  ServerIcon,
  SettingsIcon,
  TerminalIcon,
} from './icons.tsx'

interface ProbeInfo {
  reachable: boolean
  hostname?: string
  commands?: Record<string, boolean>
  error?: string
  loading?: boolean
}

/** Clean & Pure SSH Control Center settings page. */
export function RemoteSshSettings({ t: optionalT }: LocalizedProps): ReactElement {
  const t = requireTranslate(optionalT, 'SSH Control Center settings')
  const [state, setState] = useState<CatalogState>(emptyCatalog)
  const [showAddHost, setShowAddHost] = useState(false)
  const [hostCommand, setHostCommand] = useState('')
  const [configPath, setConfigPath] = useState('')
  const [customConfigDraft, setCustomConfigDraft] = useState('')
  const [message, setMessage] = useState('')
  const [copyStatus, setCopyStatus] = useState<Record<string, boolean>>({})
  const [probeResults, setProbeResults] = useState<Record<string, ProbeInfo>>({})
  const [savingSettings, setSavingSettings] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const next = await request<CatalogState>(STATE_PATH)
      setState(next)
      setConfigPath(current => next.configFiles.includes(current) ? current : next.configFiles[0] ?? '')
      setCustomConfigDraft(next.customConfigFile ?? '')
    } catch (error) {
      setMessage(String(error))
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const addHost = async (): Promise<void> => {
    if (!hostCommand.trim()) return
    await request(CONFIG_HOST_PATH, 'POST', { command: hostCommand, configPath })
    setHostCommand('')
    setShowAddHost(false)
    setMessage(t('hostAdded'))
    await refresh()
  }

  const probe = async (id: string): Promise<void> => {
    setProbeResults(prev => ({ ...prev, [id]: { reachable: false, loading: true } }))
    try {
      const result = await request<{ reachable: boolean; hostname?: string; commands?: Record<string, boolean>; error?: string }>(PROBE_PATH, 'POST', { id })
      setProbeResults(prev => ({ ...prev, [id]: { ...result, loading: false } }))
    } catch (err: any) {
      setProbeResults(prev => ({ ...prev, [id]: { reachable: false, error: err?.message || String(err), loading: false } }))
    }
  }

  const copyText = (key: string, text: string): void => {
    void navigator.clipboard.writeText(text)
    setCopyStatus(prev => ({ ...prev, [key]: true }))
    setTimeout(() => {
      setCopyStatus(prev => ({ ...prev, [key]: false }))
    }, 2000)
  }

  const saveCustomConfig = async (): Promise<void> => {
    setSavingSettings(true)
    try {
      await request(SETTINGS_PATH, 'POST', {
        sshConfigFile: customConfigDraft.trim(),
      })
      setMessage(t('configReloaded'))
      await refresh()
    } catch {
      setMessage(t('saveFailed'))
    } finally {
      setSavingSettings(false)
    }
  }

  return (
    <section style={{ ...page, maxWidth: 840, gap: 20 }}>
      {/* Header Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <TerminalIcon size={24} style={{ color: 'var(--dsw-alias-brand-primary, #3b82f6)' }} />
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>{t('title')}</h2>
          </div>
          <p style={{ ...dim, margin: 0, fontSize: 13, lineHeight: '1.5' }}>
            {t('summary', { servers: state.discoveredServerCount })}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            style={{ ...button, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}
            disabled={refreshing}
            onClick={() => { void refresh().then(() => setMessage(t('configReloaded'))) }}
          >
            <RefreshIcon size={14} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
            <span>{t('refresh')}</span>
          </button>
          <button
            style={{ ...button, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}
            onClick={() => setShowAddHost(v => !v)}
          >
            <PlusIcon size={14} />
            <span>{t('addSshHost')}</span>
          </button>
        </div>
      </div>

      {/* Notice Message */}
      {message ? (
        <div role="status" style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 16px',
          borderRadius: 10,
          background: 'var(--dsw-alias-bg-layer-2)',
          border: '1px solid var(--dsw-alias-brand-primary, #3b82f6)',
        }}>
          <TerminalIcon size={16} style={{ color: 'var(--dsw-alias-brand-primary, #3b82f6)' }} />
          <p style={{ ...dim, margin: 0, color: 'var(--dsw-alias-label-primary)', fontSize: 13 }}>{message}</p>
        </div>
      ) : null}

      {/* Section 1: Discovered Hosts Matrix */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ServerIcon size={18} style={{ color: 'var(--dsw-alias-brand-primary, #3b82f6)' }} />
            <strong style={{ fontSize: 15 }}>{t('servers')} ({state.servers.length})</strong>
          </div>
        </div>

        {state.servers.length === 0 ? <p style={dim}>{t('noHosts')}</p> : null}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
          {state.servers.map(server => {
            const probeState = probeResults[server.id]
            const isCopied = copyStatus[server.label]
            return (
              <div
                key={server.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  padding: 14,
                  borderRadius: 10,
                  border: '1px solid var(--dsw-alias-border-l2)',
                  background: 'var(--dsw-alias-bg-layer-1)',
                  transition: 'border-color 0.2s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: probeState?.reachable ? '#4ade80' : 'var(--dsw-alias-label-secondary)',
                      boxShadow: probeState?.reachable ? '0 0 8px rgba(74, 222, 128, 0.6)' : 'none',
                    }} />
                    <strong style={{ fontSize: 15, color: 'var(--dsw-alias-label-primary)' }}>{server.label}</strong>
                  </div>
                  <span style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 10,
                    fontWeight: 500,
                    background: 'var(--dsw-alias-bg-layer-2)',
                    color: 'var(--dsw-alias-label-secondary)',
                    border: '1px solid var(--dsw-alias-border-l2)',
                  }}>
                    {server.source === 'ssh-config' ? 'OpenSSH' : 'Settings'}
                  </span>
                </div>

                <div style={{
                  fontSize: 12,
                  fontFamily: 'monospace',
                  color: 'var(--dsw-alias-label-secondary)',
                  wordBreak: 'break-all',
                  background: 'var(--dsw-alias-bg-layer-2)',
                  padding: '5px 8px',
                  borderRadius: 6,
                }}>
                  {server.hostName ? `${server.user ? `${server.user}@` : ''}${server.hostName}${server.port ? `:${server.port}` : ''}` : 'SSH Target'}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    style={{ ...button, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12, padding: '5px 12px', flex: 1 }}
                    disabled={probeState?.loading}
                    onClick={() => { void probe(server.id) }}
                  >
                    <ActivityIcon size={14} style={{ color: probeState?.loading ? 'var(--dsw-alias-label-secondary)' : '#3b82f6' }} />
                    <span>{probeState?.loading ? t('probing') : t('test')}</span>
                  </button>
                  <button
                    style={{ ...button, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12, padding: '5px 12px' }}
                    onClick={() => copyText(server.label, server.label)}
                  >
                    {isCopied ? <CheckIcon size={14} style={{ color: '#4ade80' }} /> : <CopyIcon size={14} />}
                    <span>{isCopied ? t('copied') : t('copyServer')}</span>
                  </button>
                </div>

                {probeState && !probeState.loading ? (
                  <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 6,
                    padding: '8px 10px',
                    borderRadius: 6,
                    fontSize: 12,
                    lineHeight: '1.4',
                    background: probeState.reachable ? 'rgba(74, 222, 128, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                    color: probeState.reachable ? '#4ade80' : '#ef4444',
                    border: `1px solid ${probeState.reachable ? 'rgba(74, 222, 128, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`,
                  }}>
                    {probeState.reachable ? <CheckIcon size={14} style={{ marginTop: 2, flexShrink: 0 }} /> : <AlertCircleIcon size={14} style={{ marginTop: 2, flexShrink: 0 }} />}
                    <span>
                      {probeState.reachable
                        ? t('probeSuccess', {
                            hostname: probeState.hostname ?? server.label,
                            commands: Object.entries(probeState.commands ?? {}).map(([cmd, ok]) => `${cmd} ${ok ? '✓' : '×'}`).join(', '),
                          })
                        : t('probeFailure', { error: probeState.error ?? t('unknownError') })}
                    </span>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>

        {showAddHost ? (
          <div style={{ ...card, padding: 16, marginTop: 8, background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-border-l2)' }}>
            <strong style={{ fontSize: 14 }}>{t('addSshHost')}</strong>
            <input
              style={{ ...singleLineInput, width: '100%' }}
              aria-label={t('sshCommand')}
              placeholder={t('sshCommand')}
              value={hostCommand}
              onChange={e => setHostCommand(e.target.value)}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{t('chooseSshConfig')}</span>
              {state.configFiles.map(path => (
                <label key={path} style={{ ...row, alignItems: 'center', fontSize: 13 }}>
                  <input type="radio" name="target-ssh-config" checked={configPath === path} onChange={() => setConfigPath(path)} />
                  <span style={{ fontFamily: 'monospace' }}>{path}</span>
                </label>
              ))}
            </div>
            <div style={{ ...row, justifyContent: 'flex-end', marginTop: 8 }}>
              <button style={button} onClick={() => setShowAddHost(false)}>{t('cancel')}</button>
              <button style={primary} disabled={!hostCommand.trim() || !configPath} onClick={() => { void addHost() }}>{t('add')}</button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Section 2: Configuration */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SettingsIcon size={18} style={{ color: 'var(--dsw-alias-brand-primary, #3b82f6)' }} />
          <strong style={{ fontSize: 15 }}>{t('configSection')}</strong>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="custom-ssh-config-input" style={{ fontSize: 13, fontWeight: 600 }}>{t('sshConfigLabel')}</label>
          <input
            id="custom-ssh-config-input"
            style={{ ...singleLineInput, width: '100%' }}
            placeholder={t('sshConfigPlaceholder')}
            value={customConfigDraft}
            onChange={e => setCustomConfigDraft(e.target.value)}
          />
          <p style={dim}>{t('sshConfigHelp')}</p>
        </div>

        <div style={{ ...row, justifyContent: 'flex-end', marginTop: 8 }}>
          <button
            style={{
              ...button,
              background: 'var(--dsw-alias-brand-primary, #3b82f6)',
              color: '#ffffff',
              borderColor: 'transparent',
              fontWeight: 500,
              padding: '7px 18px',
            }}
            disabled={savingSettings}
            onClick={() => { void saveCustomConfig() }}
          >
            {savingSettings ? t('saving') : t('save')}
          </button>
        </div>
      </div>

      {/* Section 3: AI Cheatsheet */}
      <div style={{ ...card, background: 'var(--dsw-alias-bg-layer-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CodeIcon size={18} style={{ color: 'var(--dsw-alias-brand-primary, #3b82f6)' }} />
          <strong style={{ fontSize: 15 }}>{t('quickGuide')}</strong>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
          {[
            {
              title: '1. 单机无状态直连 (即指即跑 · 零会话污染)',
              code: 'ssh_control(action: "exec", server: "nas-server", command: "free -h && uname -a")',
            },
            {
              title: '2. 多机并发广播巡检 (秒级并行调度 · 聚合输出)',
              code: 'ssh_control(action: "exec", server: "nas-server, app-node, web-cluster", command: "uptime && df -h /")',
            },
            {
              title: '3. 远程文本精准读写 (Stdin 管道流 · 零引号转义破坏)',
              code: 'ssh_control(action: "read", server: "nas-server", path: "/etc/os-release")',
            },
            {
              title: '4. 原生 SCP 双向流式传输 (单文件 / 目录递归)',
              code: 'ssh_control(action: "upload", server: "nas-server", localPath: "dist", remotePath: "/srv/web")',
            },
          ].map((item, idx) => {
            const isCopied = copyStatus[`cheat-${idx}`]
            return (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: '10px 14px',
                  background: 'var(--dsw-alias-bg-layer-1)',
                  border: '1px solid var(--dsw-alias-border-l2)',
                  borderRadius: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <b style={{ color: 'var(--dsw-alias-label-primary)', fontSize: 13 }}>{item.title}</b>
                  <button
                    style={{
                      ...button,
                      fontSize: 11,
                      padding: '3px 8px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                    onClick={() => copyText(`cheat-${idx}`, item.code)}
                  >
                    {isCopied ? <CheckIcon size={12} style={{ color: '#4ade80' }} /> : <CopyIcon size={12} />}
                    <span>{isCopied ? t('copied') : t('copyServer')}</span>
                  </button>
                </div>
                <pre style={{
                  margin: 0,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  color: 'var(--dsw-alias-brand-primary, #60a5fa)',
                  background: 'var(--dsw-alias-bg-layer-2)',
                  padding: '6px 10px',
                  borderRadius: 6,
                  overflowX: 'auto',
                }}>
                  {item.code}
                </pre>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
