// @ 文件菜单与时间线的 File Reference chip。
import { defineDomain } from './define.ts'

export const references = defineDomain(
  {
    menuLabel: '文件',
    group: '文件与目录',
    chipLabel: '引用的文件 {path}',
    attached: '引用的文件',
  },
  {
    menuLabel: 'Files',
    group: 'Files and folders',
    chipLabel: 'Referenced file {path}',
    attached: 'Referenced files',
  },
)
