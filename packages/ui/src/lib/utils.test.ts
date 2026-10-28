import { describe, expect, it } from 'vitest'
import { cn } from '@coko/ui/lib/utils'

describe('cn', () => {
  it('后写的项目圆角覆盖先写的圆角', () => {
    expect(cn('rounded-md', 'rounded-panel')).toBe('rounded-panel')
    expect(cn('rounded-panel', 'rounded-round')).toBe('rounded-round')
    expect(cn('rounded-round', 'rounded-sm')).toBe('rounded-sm')
  })

  it('text-ui-* 字号与文字颜色互不吞掉', () => {
    expect(cn('text-ui-body text-muted-foreground')).toBe('text-ui-body text-muted-foreground')
    expect(cn('text-ui-body', 'text-ui-small')).toBe('text-ui-small')
  })

  it('项目阴影档位互相覆盖', () => {
    expect(cn('shadow-panel', 'shadow-prominent')).toBe('shadow-prominent')
  })

  it('发丝线与其他边框宽度互相覆盖', () => {
    expect(cn('border-hairline', 'border-0')).toBe('border-0')
    expect(cn('border-0', 'border-hairline')).toBe('border-hairline')
  })
})
