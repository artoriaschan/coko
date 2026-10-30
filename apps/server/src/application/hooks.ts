// 外部 Hook（ADR 0013）（M5）的应用服务。当前为存根：装配与关闭顺序已接入 runtime/layers.ts，行为由 Hook 的实现实现。
export class HookService {
  /** 有序关闭（上下文贡献之前）：等待进行中的 Hook 进程结束或终止。存根没有进行中的工作。 */
  async close(): Promise<void> {}
}
