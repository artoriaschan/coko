// composer 的 File Reference 节点（票 06）：token 模式的文本节点（原子：作为整体选中与删除，不能在其中输入），文本即序列化形式
// @path（含空白等时 @"path"），因此 getText() 与提交的文本直接带着引用，Sidecar 解析同一语法（@coko/agent 的 parseFileReferences）。
// EditorState JSON 中保存 path；导入时由 path 重建文本，path 不是字符串时抛错（草稿按损坏处理）。
import { $applyNodeReplacement, TextNode, type EditorConfig, type LexicalNode, type NodeKey, type SerializedTextNode, type Spread } from 'lexical'

/** 中文全角标点：未加引号的路径在此结束（与 Sidecar 的解析相同）。 */
const NEEDS_QUOTES = /[\s，。；：！？、）】」』》]/u
const TRAILING = /[.,;:!?'")\]}>]$/u

/** 路径 → 引用文本：含空白或全角标点、以引号开头或以会被当作结尾标点的字符结尾时加引号。 */
export function formatFileReference(path: string): string {
  return NEEDS_QUOTES.test(path) || path.startsWith('"') || TRAILING.test(path) ? `@"${path}"` : `@${path}`
}

export type SerializedFileReferenceNode = Spread<{ path: string }, SerializedTextNode>

// 行内引用的外观：小号圆角底色与链接色文字（R4，细小元素档）。
const chipClass = ['rounded-xs', 'bg-muted', 'px-0.5', 'font-medium', 'text-link']

export class FileReferenceNode extends TextNode {
  __path: string

  static override getType(): string {
    return 'file-reference'
  }

  static override clone(node: FileReferenceNode): FileReferenceNode {
    return new FileReferenceNode(node.__path, node.__key)
  }

  static override importJSON(json: SerializedFileReferenceNode): FileReferenceNode {
    if (typeof json.path !== 'string' || json.path === '') throw new Error('file-reference node without a path')
    return $createFileReferenceNode(json.path)
  }

  constructor(path = '', key?: NodeKey) {
    super(formatFileReference(path), key)
    this.__path = path
  }

  override exportJSON(): SerializedFileReferenceNode {
    return { ...super.exportJSON(), type: 'file-reference', version: 1, path: this.__path }
  }

  override createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config)
    element.classList.add(...chipClass)
    element.dataset.fileReference = this.__path
    element.spellcheck = false
    return element
  }

  getPath(): string {
    return this.getLatest().__path
  }

  override canInsertTextBefore(): boolean {
    return false
  }

  override canInsertTextAfter(): boolean {
    return false
  }

  override isTextEntity(): true {
    return true
  }
}

export function $createFileReferenceNode(path: string): FileReferenceNode {
  return $applyNodeReplacement(new FileReferenceNode(path).setMode('token'))
}

export function $isFileReferenceNode(node: LexicalNode | null | undefined): node is FileReferenceNode {
  return node instanceof FileReferenceNode
}
