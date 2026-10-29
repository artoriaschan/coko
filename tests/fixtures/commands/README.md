# 命令夹具

`tests/integration/sidecar-commands.test.ts` 与 `apps/desktop/e2e/commands.e2e.test.ts` 把这里的目录复制到临时 Workspace 与临时 `COKO_HOME`：

- `workspace/.coko/commands/`：项目级命令（含子目录命名空间与格式错误的 frontmatter）。
- `coko-home/commands/`：用户级命令（含被项目同名命令遮蔽的 `review`）。
