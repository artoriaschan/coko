// 分域字典：每个领域一个文件，导出 { zh, en }；en 的键结构由 zh 推出的类型约束（同构）。
// M3 起的新文案只写进所属领域文件，dictionaries.ts 与 dictionaries/{en,zh}.ts 不再随功能修改。

type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> }

/** 声明一个领域的中英文案；en 缺键或多键时类型检查失败。 */
export function defineDomain<const Z extends Record<string, unknown>>(zh: Z, en: Shape<Z>): { zh: Shape<Z>; en: Shape<Z> } {
  return { zh: zh as Shape<Z>, en }
}
