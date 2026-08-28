import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyEntryPatches, entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const BASE_ROWS: EntryOptions[] = [
  { id: 'subprocess', name: '@deepseek-ai/dsh-subprocess-local' },
  { id: 'fs-sandbox', name: '@deepseek-ai/dsh-fs-sandbox' },
  { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
  { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh' },
  { id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search' },
  { id: 'spill-local', name: '@deepseek-ai/dsh-spill-local' },
  { id: 'directory-picker', name: '@deepseek-ai/dsh-host-directory-picker-auto' },
]

describe('bundle overlay', () => {
  it('mounts manager and ssh_control without hijacking native tools', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'cordis.patch.yml'), 'utf8')
    const patches = load(source, { schema: entryListSchema }) as PatchOptions[]
    const warnings: string[] = []
    const rows = applyEntryPatches(BASE_ROWS, patches, (message, ...args) => {
      warnings.push([message, ...args].join(' '))
    })
    const byId = new Map(rows.map(row => [row.id, row]))

    expect(warnings).toEqual([])
    // Native tools MUST NOT be disabled
    expect(byId.get('subprocess')?.disabled).toBeUndefined()
    expect(byId.get('fs-sandbox')?.disabled).toBeUndefined()
    expect(byId.get('tool-bash')?.disabled).toBeUndefined()

    // SSH Control components MUST be present
    expect(byId.get('ssh-control-client-host')).toMatchObject({ name: '@dsh-external/dsh-ssh-control' })
    expect(byId.get('ssh-control-manager')).toMatchObject({ name: '@dsh-external/dsh-ssh-control/manager' })
    expect(byId.get('ssh-control-tool')).toMatchObject({ name: '@dsh-external/dsh-ssh-control/control-tool' })
    expect(byId.get('ssh-control-web')).toMatchObject({ name: '@dsh-external/dsh-ssh-control/web' })
  })
})
