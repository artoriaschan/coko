// @ 文件菜单与时间线的 File Reference、Session Reference chip。
import { defineDomain } from './define.ts'

export const references = defineDomain(
  {
    menuLabel: '文件',
    group: '文件与目录',
    chipLabel: '引用的文件 {path}',
    sessionChipLabel: '引用的会话 {title}',
    attached: '引用',
  },
  {
    menuLabel: 'Files',
    group: 'Files and folders',
    chipLabel: 'Referenced file {path}',
    sessionChipLabel: 'Referenced session {title}',
    attached: 'References',
  },
)
