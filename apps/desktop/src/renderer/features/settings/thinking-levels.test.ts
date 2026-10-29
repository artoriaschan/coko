// 模型选项中的推理档位（规格 4.5）：添加时补齐最早缺失的预设，修改时只能选尚未配置的档位，off 没有参数。
import type { ThinkingLevelConfig } from '@coko/protocol'
import { describe, expect, it } from 'vitest'
import { addLevel, changeLevel, levelChoices, nextLevel, normalizeLevels, removeLevel, setLevelValue } from './thinking-levels.ts'

describe('添加档位', () => {
  it('从无档位开始连续添加七次：off、minimal、low、medium、high、xhigh、max，参数值默认等于档位名；之后没有可添加的档位', () => {
    let levels: ThinkingLevelConfig[] = []
    for (let i = 0; i < 7; i++) levels = addLevel(levels)
    expect(levels).toEqual([
      { level: 'off' },
      { level: 'minimal', value: 'minimal' },
      { level: 'low', value: 'low' },
      { level: 'medium', value: 'medium' },
      { level: 'high', value: 'high' },
      { level: 'xhigh', value: 'xhigh' },
      { level: 'max', value: 'max' },
    ])
    expect(nextLevel(levels)).toBeUndefined()
    expect(addLevel(levels)).toBe(levels)
  })

  it('删除某档后再次添加补齐最早缺失档位，追加在末尾', () => {
    const levels = removeLevel([{ level: 'off' }, { level: 'minimal', value: 'minimal' }, { level: 'low', value: 'low' }], 1)
    expect(levels).toEqual([{ level: 'off' }, { level: 'low', value: 'low' }])
    expect(addLevel(levels)).toEqual([{ level: 'off' }, { level: 'low', value: 'low' }, { level: 'minimal', value: 'minimal' }])
  })
})

describe('修改档位', () => {
  const levels: ThinkingLevelConfig[] = [{ level: 'high', value: 'high' }, { level: 'off' }, { level: 'low', value: 'custom-low' }]

  it('选择项为当前档位与尚未配置的预设，按固定顺序', () => {
    expect(levelChoices(levels, 0)).toEqual(['minimal', 'medium', 'high', 'xhigh', 'max'])
    expect(levelChoices(levels, 1)).toEqual(['off', 'minimal', 'medium', 'xhigh', 'max'])
  })

  it('改为未配置的档位时参数值取新档位的默认值；改为 off 没有参数；不会改成已配置的档位', () => {
    expect(changeLevel(levels, 2, 'medium')).toEqual([{ level: 'high', value: 'high' }, { level: 'off' }, { level: 'medium', value: 'medium' }])
    expect(changeLevel([{ level: 'high', value: 'high' }], 0, 'off')).toEqual([{ level: 'off' }])
    expect(changeLevel(levels, 2, 'high')).toBe(levels)
  })

  it('编辑参数值只改该行；off 行没有参数', () => {
    expect(setLevelValue(levels, 2, 'effort-low')).toEqual([{ level: 'high', value: 'high' }, { level: 'off' }, { level: 'low', value: 'effort-low' }])
    expect(setLevelValue(levels, 1, 'x')).toBe(levels)
  })
})

it('提交时参数值去掉首尾空白，留空用档位名', () => {
  expect(normalizeLevels([{ level: 'off' }, { level: 'high', value: '  ' }, { level: 'low', value: ' effort-low ' }])).toEqual([
    { level: 'off' },
    { level: 'high', value: 'high' },
    { level: 'low', value: 'effort-low' },
  ])
})
