import { describe, expect, it } from 'vitest'
import { HOST_NOTIFICATION_KINDS, isHostBlockText, isHostNotificationText, TEAM_MESSAGE_TAG, teamMessageText } from './host-input.ts'

describe('团队消息的宿主输入', () => {
  it('teamMessageText 以 TEAM_MESSAGE_TAG 开头，属性值经 XML 转义，正文原样', () => {
    const text = teamMessageText({ from: 'a"><x', messageId: "m'1&", body: '<b>keep</b>' })
    expect(text.startsWith(TEAM_MESSAGE_TAG)).toBe(true)
    expect(text).toBe('<team-message from="a&quot;&gt;&lt;x" message-id="m&#39;1&amp;">\n<b>keep</b>\n</team-message>')
  })

  it('team_message 属于宿主通知：kind 在 HOST_NOTIFICATION_KINDS 中，文本被识别为宿主通知与宿主文本块', () => {
    expect(HOST_NOTIFICATION_KINDS.has('team_message')).toBe(true)
    const text = teamMessageText({ from: 'lead', messageId: 'm1', body: 'hi' })
    expect(isHostNotificationText(text)).toBe(true)
    expect(isHostBlockText(text)).toBe(true)
    expect(isHostNotificationText('team-message from lead')).toBe(false)
  })
})
