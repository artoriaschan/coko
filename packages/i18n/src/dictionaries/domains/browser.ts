// 右栏浏览器页：开始页入口与占位页的工具栏。页面承载尚未提供，控件均为禁用。
import { defineDomain } from './define.ts'

export const browser = defineDomain(
  {
    tab: '浏览器',
    description: '浏览网页',
    back: '后退',
    forward: '前进',
    reload: '刷新',
    address: '输入 HTTP(S) 地址',
    external: '在系统浏览器中打开',
    unavailable: '浏览器尚未提供',
  },
  {
    tab: 'Browser',
    description: 'Browse web pages',
    back: 'Back',
    forward: 'Forward',
    reload: 'Reload',
    address: 'Enter an HTTP(S) address',
    external: 'Open in system browser',
    unavailable: 'The browser is not available yet',
  },
)
