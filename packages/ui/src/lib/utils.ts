import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// 登记项目 token，使 tailwind-merge 能识别 text-ui-*、rounded-panel / rounded-round 等类的冲突组。
const twMerge = extendTailwindMerge<'border-w-hairline'>({
  extend: {
    theme: {
      radius: ['panel'],
      text: ['ui-caption', 'ui-small', 'ui-body', 'ui-body-lg', 'ui-title', 'ui-heading', 'ui-display'],
      shadow: ['panel', 'prominent', 'soft'],
    },
    classGroups: {
      rounded: ['rounded-round'],
      'border-w': ['border-hairline'],
      'border-w-t': ['border-t-hairline'],
      'border-w-b': ['border-b-hairline'],
      'border-w-l': ['border-l-hairline'],
      'border-w-r': ['border-r-hairline'],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
