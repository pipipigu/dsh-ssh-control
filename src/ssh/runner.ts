import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { isAbsolute, resolve as resolvePath } from 'node:path'

export interface SshExecResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  durationMs: number
}

export interface DiskMountInfo {
  filesystem: string
  size: string
  used: string
  available: string
  percent: string
  mount: string
}

export interface DockerContainerInfo {
  id: string
  names: string
  image: string
  status: string
  state: string
  ports: string
  created: string
}

export interface ActiveTunnel {
  id: string
  server: string
  localPort: number
  targetHost: string
  targetPort: number
  pid?: number | undefined
  startedAt: number
}

/** Active background SSH port-forwarding tunnels */
const activeTunnels = new Map<string, { info: ActiveTunnel; child: ReturnType<typeof spawn> }>()

/** Decode buffer with intelligent multi-encoding fallback (UTF-8 -> GBK/GB18030 -> utf8 lenient) */
export function decodeOutputBuffer(buf: Buffer): string {
  if (buf.length === 0) return ''
  try {
    const utf8Decoder = new TextDecoder('utf-8', { fatal: true })
    return utf8Decoder.decode(buf)
  } catch {
    try {
      const gbkDecoder = new TextDecoder('gbk')
      return gbkDecoder.decode(buf)
    } catch {
      return buf.toString('utf8')
    }
  }
}

export function quotePosix(value: string): string {
  if (value.includes('\0')) throw new Error('command arguments cannot contain NUL bytes')
  return `'${value.replaceAll("'", "'\"'\"'")}'`
}

/** Execute a remote command via OpenSSH with encoding self-heal and dialect wrapping */
export async function runRemoteSshCommand(
  target: string,
  command: string,
  opts?: {
    workdir?: string | undefined
    timeoutMs?: number | undefined
    stdin?: string | undefined
    sshArgs?: string[] | undefined
    isWindows?: boolean | undefined
  }
): Promise<SshExecResult> {
  const timeoutMs = opts?.timeoutMs ?? 60_000
  const workdir = opts?.workdir?.trim()
  
  let wrappedCommand: string
  if (workdir) {
    if (opts?.isWindows) {
      wrappedCommand = `powershell -NoProfile -Command "Set-Location -LiteralPath '${workdir.replace(/'/g, "''")}'; ${command}"`
    } else {
      wrappedCommand = `(cd ${quotePosix(workdir)} 2>/dev/null || cd ~) && ${command}`
    }
  } else {
    wrappedCommand = command
  }

  const args = [...(opts?.sshArgs ?? []), '-o', 'BatchMode=yes', target, wrappedCommand]
  const startTime = Date.now()

  return new Promise<SshExecResult>((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('ssh', args, {
        stdio: [opts?.stdin !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      })
    } catch (err: any) {
      return resolve({
        exitCode: -1,
        stdout: '',
        stderr: err?.message || String(err),
        timedOut: false,
        durationMs: Date.now() - startTime,
      })
    }

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let timedOut = false
    let timer: NodeJS.Timeout | undefined

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
      }, timeoutMs)
    }

    if (opts?.stdin !== undefined && child.stdin) {
      child.stdin.end(opts.stdin)
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk)
    })

    child.on('close', (code) => {
      if (timer !== undefined) clearTimeout(timer)
      const stdout = decodeOutputBuffer(Buffer.concat(stdoutChunks)).trimEnd()
      const stderr = decodeOutputBuffer(Buffer.concat(stderrChunks)).trimEnd()
      resolve({
        exitCode: code,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - startTime,
      })
    })

    child.on('error', (err) => {
      if (timer !== undefined) clearTimeout(timer)
      const stderr = decodeOutputBuffer(Buffer.concat(stderrChunks)).trimEnd()
      resolve({
        exitCode: -1,
        stdout: decodeOutputBuffer(Buffer.concat(stdoutChunks)).trimEnd(),
        stderr: (stderr ? stderr + '\n' : '') + (err?.message || String(err)),
        timedOut,
        durationMs: Date.now() - startTime,
      })
    })
  })
}

/** Read a remote file with line bounding */
export async function readRemoteFile(
  target: string,
  filePath: string,
  opts?: { offset?: number | undefined; limit?: number | undefined; sshArgs?: string[] | undefined; isWindows?: boolean | undefined }
): Promise<{ content: string; lines: number; totalLines?: number }> {
  const offset = opts?.offset ?? 1
  const limit = opts?.limit ?? 2000
  
  let cmd: string
  if (opts?.isWindows) {
    cmd = `powershell -NoProfile -Command "Get-Content -LiteralPath '${filePath.replace(/'/g, "''")}' | Select-Object -Skip ${offset - 1} -First ${limit}"`
  } else {
    cmd = `sed -n '${offset},${offset + limit - 1}p' -- ${quotePosix(filePath)}`
  }

  const res = await runRemoteSshCommand(target, cmd, { ...(opts?.sshArgs ? { sshArgs: opts.sshArgs } : {}), isWindows: opts?.isWindows })
  if (res.exitCode !== 0) {
    throw new Error(res.stderr || `Failed to read ${filePath} (exit ${res.exitCode})`)
  }
  const lines = res.stdout ? res.stdout.split('\n').length : 0
  return { content: res.stdout, lines }
}

/** Write remote file content via stdin stream (zero-escape loss) */
export async function writeRemoteFile(
  target: string,
  filePath: string,
  content: string,
  opts?: { sshArgs?: string[] | undefined; isWindows?: boolean | undefined }
): Promise<{ bytes: number; path: string }> {
  let cmd: string
  if (opts?.isWindows) {
    cmd = `powershell -NoProfile -Command "$dir = Split-Path -Parent '${filePath.replace(/'/g, "''")}'; if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }; [Console]::Input.ReadToEnd() | Out-File -FilePath '${filePath.replace(/'/g, "''")}' -Encoding utf8"`
  } else {
    cmd = `mkdir -p -- "$(dirname -- ${quotePosix(filePath)})" && cat > ${quotePosix(filePath)}`
  }

  const res = await runRemoteSshCommand(target, cmd, { stdin: content, ...(opts?.sshArgs ? { sshArgs: opts.sshArgs } : {}), isWindows: opts?.isWindows })
  if (res.exitCode !== 0) {
    throw new Error(res.stderr || `Failed to write ${filePath} (exit ${res.exitCode})`)
  }
  return { bytes: Buffer.byteLength(content, 'utf8'), path: filePath }
}

/** Upload local file or directory to remote host via OpenSSH SCP stream */
export async function uploadViaScp(
  target: string,
  localPath: string,
  remotePath: string,
  opts?: { recursive?: boolean | undefined; timeoutMs?: number | undefined; sshArgs?: string[] | undefined }
): Promise<{ bytes: number; durationMs: number; source: string; target: string }> {
  const timeoutMs = opts?.timeoutMs ?? 180_000
  const absLocalPath = isAbsolute(localPath) ? localPath : resolvePath(process.cwd(), localPath)
  
  let isDirectory = false
  let totalBytes = 0
  try {
    const stat = await fs.stat(absLocalPath)
    isDirectory = stat.isDirectory()
    totalBytes = stat.size
  } catch (err: any) {
    throw new Error(`upload: local file not accessible: ${absLocalPath} (${err.message})`)
  }

  const shouldRecursive = opts?.recursive ?? isDirectory
  const scpArgs = [
    ...(opts?.sshArgs ?? []),
    '-o', 'BatchMode=yes',
    ...(shouldRecursive ? ['-r'] : []),
    absLocalPath,
    `${target}:${remotePath}`,
  ]

  const startTime = Date.now()
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('scp', scpArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err: any) {
      return reject(new Error(`upload failed to spawn scp: ${err.message}`))
    }

    let stderrChunks: Buffer[] = []
    let timer: NodeJS.Timeout | undefined
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGTERM')
        reject(new Error(`upload timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    }

    child.stderr?.on('data', (d) => stderrChunks.push(d))

    child.on('close', (code) => {
      if (timer !== undefined) clearTimeout(timer)
      if (code === 0) {
        resolve({
          bytes: totalBytes,
          durationMs: Date.now() - startTime,
          source: absLocalPath,
          target: `${target}:${remotePath}`,
        })
      } else {
        const stderr = decodeOutputBuffer(Buffer.concat(stderrChunks))
        reject(new Error(stderr || `upload failed with exit code ${code}`))
      }
    })

    child.on('error', (err) => {
      if (timer !== undefined) clearTimeout(timer)
      reject(err)
    })
  })
}

/** Download remote file or directory to local host via OpenSSH SCP stream */
export async function downloadViaScp(
  target: string,
  remotePath: string,
  localPath: string,
  opts?: { recursive?: boolean | undefined; timeoutMs?: number | undefined; sshArgs?: string[] | undefined }
): Promise<{ durationMs: number; source: string; target: string; bytes?: number }> {
  const timeoutMs = opts?.timeoutMs ?? 180_000
  const absLocalPath = isAbsolute(localPath) ? localPath : resolvePath(process.cwd(), localPath)
  
  // Ensure local parent directory exists
  try {
    const parentDir = resolvePath(absLocalPath, '..')
    await fs.mkdir(parentDir, { recursive: true })
  } catch {}

  const scpArgs = [
    ...(opts?.sshArgs ?? []),
    '-o', 'BatchMode=yes',
    ...(opts?.recursive ? ['-r'] : []),
    `${target}:${remotePath}`,
    absLocalPath,
  ]

  const startTime = Date.now()
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('scp', scpArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err: any) {
      return reject(new Error(`download failed to spawn scp: ${err.message}`))
    }

    let stderrChunks: Buffer[] = []
    let timer: NodeJS.Timeout | undefined
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGTERM')
        reject(new Error(`download timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    }

    child.stderr?.on('data', (d) => stderrChunks.push(d))

    child.on('close', async (code) => {
      if (timer !== undefined) clearTimeout(timer)
      if (code === 0) {
        let bytes = 0
        try {
          const stat = await fs.stat(absLocalPath)
          bytes = stat.size
        } catch {}
        resolve({
          durationMs: Date.now() - startTime,
          source: `${target}:${remotePath}`,
          target: absLocalPath,
          bytes,
        })
      } else {
        const stderr = decodeOutputBuffer(Buffer.concat(stderrChunks))
        reject(new Error(stderr || `download failed with exit code ${code}`))
      }
    })

    child.on('error', (err) => {
      if (timer !== undefined) clearTimeout(timer)
      reject(err)
    })
  })
}

/** Tail remote logs with optional keyword/error filter */
export async function tailRemoteFile(
  target: string,
  filePath: string,
  opts?: { lines?: number | undefined; pattern?: string | undefined; isWindows?: boolean | undefined }
): Promise<{ lines: string[]; count: number; server: string; path: string }> {
  const lineCount = opts?.lines ?? 50
  let cmd: string

  if (opts?.isWindows) {
    const filter = opts?.pattern ? ` | Select-String -Pattern '${opts.pattern.replace(/'/g, "''")}'` : ''
    cmd = `powershell -NoProfile -Command "Get-Content -Tail ${lineCount} -LiteralPath '${filePath.replace(/'/g, "''")}'${filter}"`
  } else {
    const filter = opts?.pattern ? ` | grep -E -i ${quotePosix(opts.pattern)}` : ''
    cmd = `tail -n ${lineCount} -- ${quotePosix(filePath)}${filter}`
  }

  const res = await runRemoteSshCommand(target, cmd, { isWindows: opts?.isWindows })
  if (res.exitCode !== 0 && res.stderr && !res.stdout) {
    throw new Error(res.stderr || `Failed to tail ${filePath} (exit ${res.exitCode})`)
  }

  const outputLines = res.stdout ? res.stdout.split('\n') : []
  return {
    lines: outputLines,
    count: outputLines.length,
    server: target,
    path: filePath,
  }
}

/** Parse Linux df -h output into structured disks array */
export function parseDiskUsage(dfOutput: string): DiskMountInfo[] {
  const lines = dfOutput.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length <= 1) return []
  
  const results: DiskMountInfo[] = []
  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]!.split(/\s+/)
    if (parts.length >= 6) {
      results.push({
        filesystem: parts[0] ?? '',
        size: parts[1] ?? '',
        used: parts[2] ?? '',
        available: parts[3] ?? '',
        percent: parts[4] ?? '',
        mount: parts.slice(5).join(' '),
      })
    }
  }
  return results
}

/** Parse docker ps json or formatted list into structured container records */
export function parseDockerList(output: string): DockerContainerInfo[] {
  const lines = output.split('\n').map(l => l.trim()).filter(Boolean)
  const containers: DockerContainerInfo[] = []
  for (const line of lines) {
    try {
      const obj = JSON.parse(line)
      containers.push({
        id: obj.ID ?? obj.Id ?? '',
        names: obj.Names ?? obj.Name ?? '',
        image: obj.Image ?? '',
        status: obj.Status ?? '',
        state: obj.State ?? '',
        ports: obj.Ports ?? '',
        created: obj.CreatedAt ?? obj.Created ?? '',
      })
    } catch {
      // ignore unparseable non-json lines
    }
  }
  return containers
}

/** Start a background SSH port forwarding tunnel (localPort -> targetHost:targetPort) */
export async function startTunnel(
  server: string,
  localPort: number,
  targetPort: number,
  targetHost = '127.0.0.1',
  sshArgs?: string[]
): Promise<ActiveTunnel> {
  const tunnelId = `${server}-${localPort}-${targetPort}`
  const existing = activeTunnels.get(tunnelId)
  if (existing) {
    return existing.info
  }

  const args = [
    ...(sshArgs ?? []),
    '-o', 'BatchMode=yes',
    '-N',
    '-L', `${localPort}:${targetHost}:${targetPort}`,
    server,
  ]

  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err: any) {
      return reject(new Error(`Failed to spawn tunnel: ${err.message}`))
    }

    let stderr = ''
    child.stderr?.on('data', (d) => stderr += d.toString())

    const info: ActiveTunnel = {
      id: tunnelId,
      server,
      localPort,
      targetHost,
      targetPort,
      pid: child.pid,
      startedAt: Date.now(),
    }

    activeTunnels.set(tunnelId, { info, child })

    // Give it 800ms to detect early bind failure
    setTimeout(() => {
      if (child.exitCode !== null) {
        activeTunnels.delete(tunnelId)
        reject(new Error(stderr || `Tunnel exited immediately with code ${child.exitCode}`))
      } else {
        resolve(info)
      }
    }, 800)

    child.on('close', () => {
      activeTunnels.delete(tunnelId)
    })
  })
}

/** Stop a running SSH tunnel */
export function stopTunnel(tunnelId: string): boolean {
  const entry = activeTunnels.get(tunnelId)
  if (entry) {
    try {
      entry.child.kill('SIGTERM')
    } catch {}
    activeTunnels.delete(tunnelId)
    return true
  }
  return false
}

/** List all active tunnels */
export function listActiveTunnels(): ActiveTunnel[] {
  return Array.from(activeTunnels.values()).map(v => v.info)
}
