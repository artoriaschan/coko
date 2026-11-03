export const STARTUP_AVATAR_URL = new URL('../../../../../brand/rukie-avatar.png', import.meta.url).href

/** 应用启动时的品牌加载屏：顶栏保持窗口拖拽，正文居中展示圆形角色图。 */
export function StartupScreen({ label }: { label: string }) {
  return (
    <div
      data-slot="startup-screen"
      role="status"
      aria-label={label}
      aria-live="polite"
      aria-busy="true"
      className="grid h-full w-full place-items-center overflow-hidden rounded-panel bg-background"
    >
      <div data-window-drag className="absolute inset-x-0 top-0 h-(--frame-top-clearance)" />
      <img
        src={STARTUP_AVATAR_URL}
        alt=""
        aria-hidden
        className="aspect-square shrink-0 rounded-round object-cover"
        style={{ width: 'min(250px, calc(100% - 64px))' }}
      />
    </div>
  )
}
