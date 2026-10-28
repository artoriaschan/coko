import { createTranslator, dictionaries, type Locale, type Translator } from '@coko/i18n'
import * as React from 'react'

interface I18nValue {
  locale: Locale
  t: Translator
  dictionary: (typeof dictionaries)[Locale]
}

const I18nContext = React.createContext<I18nValue | null>(null)

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = React.useMemo(() => ({ locale, t: createTranslator(locale), dictionary: dictionaries[locale] }), [locale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const value = React.useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>')
  return value
}
