import { useI18n } from '../../app/i18n.tsx'

const avatar = new URL('../../../../../../brand/rukie-avatar.png', import.meta.url).href

/** 使用已确认的品牌资产；欢迎内容和输入区构成一个居中的工作入口。 */
export function NewChatWelcome() {
  const { t } = useI18n()
  return (
    <div data-slot="new-chat-welcome" className="mx-auto flex w-full max-w-[768px] items-center justify-center gap-8 pb-10 @max-[600px]/main:gap-4">
      <img src={avatar} alt={t('app.name')} className="size-44 shrink-0 object-contain mask-b-from-[84%] mask-b-to-100% @max-[600px]/main:size-28" />
      <div className="min-w-0">
        <h2 className="text-ui-display font-medium @max-[600px]/main:text-ui-heading">{t('conversation.welcomeTitle')}</h2>
        <p className="mt-2 text-ui-body-lg text-muted-foreground">{t('conversation.welcomeBody')}</p>
      </div>
    </div>
  )
}
