import { expect, it } from 'vitest'
import { applicationMenuTemplate } from './application-menu.ts'

it('keeps standard platform menus and routes File Close through CmdOrCtrl+W', () => {
  const template = applicationMenuTemplate('darwin', { file: 'File', close: 'Close' }, () => {})
  expect(template.map((item) => item.role ?? item.label)).toEqual(['appMenu', 'File', 'editMenu', 'viewMenu', 'windowMenu'])
  const file = template.find((item) => item.label === 'File')!
  expect(Array.isArray(file.submenu)).toBe(true)
  if (!Array.isArray(file.submenu)) throw new Error('File must have a submenu')
  const close = file.submenu.find((item) => item.id === 'coko-close')!
  expect([close.label, close.accelerator, close.role]).toEqual(['Close', 'CmdOrCtrl+W', undefined])
  expect(applicationMenuTemplate('win32', { file: '文件', close: '关闭' }, () => {}).map((item) => item.role ?? item.label)).toEqual([
    '文件',
    'editMenu',
    'viewMenu',
    'windowMenu',
  ])
})
