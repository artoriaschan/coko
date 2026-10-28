import { en } from './dictionaries/en.ts'
import { zh } from './dictionaries/zh.ts'

export type Dictionary = typeof zh

export const dictionaries = { zh, en } satisfies Record<string, Dictionary>
