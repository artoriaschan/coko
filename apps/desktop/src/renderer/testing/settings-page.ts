// 浏览器测试共用：整页设置的定位。设置是名为“设置 / Settings”的 region landmark（不再是对话框）。
import { page } from 'vitest/browser'

/** 整页设置区域；未打开时不在文档中。 */
export const settingsRegion = () => page.getByRole('region', { name: /^(Settings|设置)$/ })
