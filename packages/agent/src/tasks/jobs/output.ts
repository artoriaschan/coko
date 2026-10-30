// 后台任务的输出（docs/subsystems/jobs.md）：内存环形缓冲（按字节，保留最近 256 KB）与模型游标、ANSI 控制序列去除、label。
// 写入环形之前宿主已按值替换登记明文；偏移是脱敏后文本的 UTF-8 字节偏移，与日志文件一致。

/** 环形缓冲保留的字节数。 */
export const JOB_RING_BYTES = 256 * 1024
/** label 的最大长度（字符）。 */
export const JOB_LABEL_MAX = 120

/** 从偏移 offset 起的输出；dropped 为游标落后于环形起点而丢失的字节数。 */
export interface OutputSlice {
  text: string
  offset: number
  nextOffset: number
  dropped: number
}

/** 按字节保留最近 capacity 字节的输出，偏移从 Job 开始起算（不随丢弃重置）。 */
export class OutputRing {
  readonly #capacity: number
  #chunks: Buffer[] = []
  #size = 0
  #end = 0

  constructor(capacity = JOB_RING_BYTES) {
    this.#capacity = capacity
  }

  /** 至今写入的总字节数（下一块的偏移）。 */
  get end(): number {
    return this.#end
  }

  /** 环形中最早一个字节的偏移。 */
  get start(): number {
    return this.#end - this.#size
  }

  /** 追加一段文本，返回它的起始偏移。 */
  append(text: string): number {
    const offset = this.#end
    if (text === '') return offset
    const bytes = Buffer.from(text, 'utf8')
    this.#chunks.push(bytes)
    this.#size += bytes.length
    this.#end += bytes.length
    while (this.#size > this.#capacity && this.#chunks.length > 0) {
      const head = this.#chunks[0]!
      const excess = this.#size - this.#capacity
      if (head.length <= excess) {
        this.#chunks.shift()
        this.#size -= head.length
      } else {
        this.#chunks[0] = head.subarray(excess)
        this.#size -= excess
      }
    }
    return offset
  }

  /** offset 起至今的输出（落在环形之前的部分丢弃并计入 dropped；被截断的首个多字节字符解码为替换字符）。 */
  read(offset: number): OutputSlice {
    const from = Math.max(offset, this.start)
    const dropped = from - offset
    const all = Buffer.concat(this.#chunks)
    return { text: all.subarray(from - this.start).toString('utf8'), offset: from, nextOffset: this.#end, dropped: Math.max(0, dropped) }
  }
}

// CSI、OSC（BEL 或 ST 结束）、其他两字节 ESC 序列与单独的 C1 CSI；与 ansi-regex 覆盖的范围相同。
const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?(?:\u0007|\u001B\u005C|\u009C))|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g

/** 去除 ANSI 控制序列，把 CRLF 归一为 LF（模型读取用；日志保留原始输出）。 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '').replace(/\r\n/g, '\n')
}

/** label：命令的第一个非空行，去掉首尾空白，超过 120 字符时截断并加省略号。 */
export function jobLabel(command: string): string {
  const line =
    command
      .split('\n')
      .find((l) => l.trim() !== '')
      ?.trim() ?? ''
  return line.length > JOB_LABEL_MAX ? line.slice(0, JOB_LABEL_MAX - 1) + '…' : line
}
