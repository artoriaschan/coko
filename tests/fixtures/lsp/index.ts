// 语言服务器测试夹具的路径与一个最小客户端（夹具自测与代码智能的用例共用）。
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const lspServerEntry = fileURLToPath(new URL('./server.mjs', import.meta.url))

/** 帧编码（Content-Length）。 */
export const frame = (message: object) => {
  const body = JSON.stringify({ jsonrpc: '2.0', ...message })
  return 'Content-Length: ' + Buffer.byteLength(body, 'utf8') + '\r\n\r\n' + body
}

/** 以当前 node 启动夹具：逐条解码收到的消息，send 发送一条。 */
export function startLspFixture(args: string[] = []) {
  const child = spawn(process.execPath, [lspServerEntry, ...args], { stdio: ['pipe', 'pipe', 'inherit'] })
  const received: Record<string, unknown>[] = []
  let buffer = Buffer.alloc(0)
  child.stdout.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    for (;;) {
      const end = buffer.indexOf('\r\n\r\n')
      if (end < 0) return
      const length = Number(/Content-Length: *(\d+)/i.exec(buffer.subarray(0, end).toString('ascii'))?.[1])
      if (buffer.length < end + 4 + length) return
      received.push(JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString('utf8')) as Record<string, unknown>)
      buffer = buffer.subarray(end + 4 + length)
    }
  })
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)))
  return { child, received, exited, send: (message: object) => child.stdin.write(frame(message)) }
}
