// JSON-RPC 2.0 的 Content-Length 分帧（LSP base protocol）：头部为 ASCII 的 `Name: value\r\n` 行，空行之后是 UTF-8 的 JSON 正文。

/** 一帧正文的上限；超出视为非法帧（防止错误的头部让缓冲无限增长）。 */
export const LSP_MAX_FRAME_BYTES = 64 * 1024 * 1024
/** 头部的上限（找不到空行时）。 */
const MAX_HEADER_BYTES = 8 * 1024
const SEPARATOR = Buffer.from('\r\n\r\n', 'ascii')

/** 编码一条消息（不改动 jsonrpc 字段，调用方给出完整消息）。 */
export function encodeFrame(message: object): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body])
}

export interface FrameDecoder {
  /** 收到的字节（任意切分：分包与粘包都可以）。 */
  push(chunk: Buffer): void
}

/**
 * 解码：每解出一条消息调用 onMessage。非法帧（没有或不是数字的 Content-Length、超出上限、正文不是 JSON）调用 onError 并跳过该帧，
 * 之后的帧照常解码。
 */
export function decodeFrames(onMessage: (message: unknown) => void, onError: (error: Error) => void = () => undefined): FrameDecoder {
  let buffer: Buffer = Buffer.alloc(0)
  return {
    push(chunk) {
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk])
      for (;;) {
        const end = buffer.indexOf(SEPARATOR)
        if (end < 0) {
          if (buffer.length > MAX_HEADER_BYTES) {
            onError(new Error('Invalid frame: header too long'))
            buffer = Buffer.alloc(0)
          }
          return
        }
        const header = buffer.subarray(0, end).toString('ascii')
        const match = /^content-length: *(\d+) *$/im.exec(header)
        const length = match ? Number(match[1]) : Number.NaN
        if (!Number.isSafeInteger(length) || length > LSP_MAX_FRAME_BYTES) {
          onError(new Error(match ? `Invalid frame: Content-Length ${match[1]} exceeds the limit` : 'Invalid frame: missing or non-numeric Content-Length'))
          buffer = buffer.subarray(end + SEPARATOR.length)
          continue
        }
        const start = end + SEPARATOR.length
        if (buffer.length < start + length) return
        const body = buffer.subarray(start, start + length).toString('utf8')
        buffer = buffer.subarray(start + length)
        let message: unknown
        try {
          message = JSON.parse(body)
        } catch (error) {
          onError(new Error(`Invalid frame: body is not JSON (${error instanceof Error ? error.message : String(error)})`))
          continue
        }
        onMessage(message)
      }
    },
  }
}
