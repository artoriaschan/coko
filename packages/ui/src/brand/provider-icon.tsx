import { BotIcon } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { BRAND_GLYPHS, brandOf, type BrandHints, type BrandId } from './brands.ts'

/** color：品牌色（没有彩色版本时用单色）；mono：单色，跟随文字颜色。 */
export type BrandIconVariant = 'color' | 'mono'

export interface BrandIconProps {
  brand: BrandId
  /** 边长（px）。 */
  size?: number
  variant?: BrandIconVariant
  className?: string
}

/** 品牌图标。 */
export function BrandIcon({ brand, size = 16, variant = 'color', className }: BrandIconProps) {
  const glyphs = BRAND_GLYPHS[brand]
  const colored = variant === 'color' && glyphs.color !== undefined
  const Glyph = colored ? glyphs.color! : glyphs.mono
  return <Glyph size={size} aria-hidden className={cn('shrink-0', !colored && (variant === 'mono' ? 'text-foreground' : 'text-muted-foreground'), className)} />
}

export interface ProviderIconProps extends BrandHints {
  size?: number
  variant?: BrandIconVariant
  className?: string
}

/**
 * 模型或供应商的品牌图标。先按模型 ID 识别，再按接口地址、供应商 ID 与名称识别；
 * 未收录的品牌显示通用图标，保证列表行前导位置一致。
 */
export function ProviderIcon({ size = 16, variant = 'color', className, ...hints }: ProviderIconProps) {
  const brand = brandOf(hints)
  if (brand !== null) return <BrandIcon brand={brand} size={size} variant={variant} className={className} />
  return <BotIcon aria-hidden size={size} className={cn('shrink-0 text-muted-foreground', className)} />
}
