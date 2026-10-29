// 分层配置：General 分区的项目设置行与能力开关、Permissions 分区的项目规则。
import { defineDomain } from './define.ts'

export const config = defineDomain(
  {
    project: {
      label: '项目设置',
      noWorkspace: '打开一个会话后可查看其工作区的项目设置',
      loading: '正在读取项目设置',
      loadFailed: '未能读取项目设置',
      missing: '未创建',
      noIssues: '没有问题',
      issues: '{count} 个问题',
      showIssues: '查看项目设置的问题',
      hint: '项目设置只能关闭能力或追加拒绝与询问规则，不能放开权限',
    },
    diagnostics: {
      'unknown-key': '未知的设置项',
      'invalid-value': '值的格式不对，已忽略',
      'project-cannot-grant': '项目设置不能放开权限或开启能力，已忽略',
      'invalid-json': '不是有效的 JSON，整个文件被忽略',
      'read-failed': '无法读取文件',
      other: '设置有问题',
    },
    projectRules: {
      title: '项目规则',
      hint: '来自 {path}，只读；修改该文件后下一次 Run 生效',
    },
    capabilities: {
      title: '上下文',
      disabledByProject: '已被项目设置关闭',
      saveFailed: '未能保存设置',
      instructions: { label: '读取指令文件', hint: '关闭后不读取 AGENTS.md / CLAUDE.md（用户级、仓库与子目录）' },
      autoCompact: { label: '自动压缩上下文', hint: '上下文接近窗口上限时自动摘要较早的对话；关闭后仍可用 /compact' },
      trimOldToolResults: { label: '清理较旧的工具输出', hint: '间隔超过 60 分钟后，发给模型的较早大段工具结果替换为说明文本' },
      mcp: { label: '使用 MCP', hint: '关闭后不连接任何 MCP Server，也不注册其工具与提示模板' },
      commands: { label: '使用命令', hint: '关闭后 / 命令不展开，原样作为消息发送' },
    },
  },
  {
    project: {
      label: 'Project settings',
      noWorkspace: "Open a session to see its workspace's project settings",
      loading: 'Reading project settings',
      loadFailed: "Couldn't read project settings",
      missing: 'Not created',
      noIssues: 'No issues',
      issues: '{count} issue(s)',
      showIssues: 'Show project settings issues',
      hint: 'Project settings can only turn capabilities off or add deny and ask rules; they cannot grant permissions',
    },
    diagnostics: {
      'unknown-key': 'Unknown setting',
      'invalid-value': 'Invalid value, ignored',
      'project-cannot-grant': 'Project settings cannot grant permissions or turn capabilities on; ignored',
      'invalid-json': 'Not valid JSON; the whole file is ignored',
      'read-failed': "Couldn't read the file",
      other: 'Setting problem',
    },
    projectRules: {
      title: 'Project rules',
      hint: 'From {path}, read-only; edit that file and the next Run picks it up',
    },
    capabilities: {
      title: 'Context',
      disabledByProject: 'Turned off by project settings',
      saveFailed: "Couldn't save the setting",
      instructions: { label: 'Read instruction files', hint: 'When off, AGENTS.md / CLAUDE.md files (user, repository and subdirectories) are not read' },
      autoCompact: {
        label: 'Compact context automatically',
        hint: 'Summarizes earlier conversation when the context nears the window; /compact still works when off',
      },
      trimOldToolResults: {
        label: 'Clear old tool output',
        hint: 'After a 60-minute gap, large older tool results sent to the model are replaced with a note',
      },
      mcp: { label: 'Use MCP', hint: 'When off, no MCP server connects and their tools and prompts are not registered' },
      commands: { label: 'Use commands', hint: 'When off, / commands are not expanded and are sent as plain messages' },
    },
  },
)
