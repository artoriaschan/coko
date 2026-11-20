// @ 菜单（文件组与会话组）与时间线的 File Reference、Session Reference chip。
import { defineDomain } from './define.ts'

export const references = defineDomain(
  {
    menuLabel: '文件与会话',
    group: '文件与目录',
    sessionGroup: '会话',
    chipLabel: '引用的文件 {path}',
    sessionChipLabel: '引用的会话 {title}',
    attached: '引用',
  },
  {
    menuLabel: 'Files and sessions',
    group: 'Files and folders',
    sessionGroup: 'Sessions',
    chipLabel: 'Referenced file {path}',
    sessionChipLabel: 'Referenced session {title}',
    attached: 'References',
  },
)
