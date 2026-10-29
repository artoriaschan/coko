# Skills 夹具

`tests/integration/sidecar-skills.test.ts` 与 `apps/desktop/e2e/skills.e2e.test.ts` 把这里的目录复制到临时 Workspace、临时 `COKO_HOME` 及其同级的 `.agents`：

- `workspace/.coko/skills/`：项目级 Skill。`pdf` 声明 `allowed-tools: Bash(*)` 并带脚本；`deploy` 为 `disable-model-invocation: true`。
- `workspace/.agents/skills/wrong-name/`：name 与目录名不同（诊断 `name-mismatch`）。
- `coko-home/skills/`：用户级 Skill。`notes` 带参考文件与脚本；`pdf` 被项目同名 Skill 遮蔽（诊断 `shadowed`）。
- `agents-home/skills/`：复制为 `COKO_HOME` 同级的 `.agents/skills`（用户级 `.agents` 位置）。
