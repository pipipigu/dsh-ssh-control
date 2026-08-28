/** Browser entry: localized settings and plugin cards. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { en, zh } from './locales.ts'
import type { RemoteSshLocaleKey } from './locales.ts'
import { RemoteSshPluginCard } from './RemoteSshPluginCard.tsx'
import { RemoteSshSettings } from './RemoteSshSettings.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** SSH Control settings copy. */
    'settings.ssh-control': RemoteSshLocaleKey
  }
}

export const name = 'dsh-ssh-control-client'
export const inject = ['slots', 'locale']

/** Register the localized settings and plugin cards. */
export async function apply(ctx: ClientContext): Promise<void> {
  const namespace = 'settings.ssh-control'
  ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'dsh-ssh-control: client copy')
  const t = ctx.locale.bind(namespace)

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'ssh-control', order: 16, label: () => t('nav'), inject: () => ({ t }),
  }, RemoteSshSettings))

  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item', key: namespace, inject: () => ({ t }),
  }, RemoteSshPluginCard))
}
