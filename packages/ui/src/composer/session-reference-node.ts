// composer 的 Session Reference 节点：行内的原子节点，chip 显示 @标题（选中那一刻的快照），文本内容为序列化形式 @session:<id>，
// 因此 getText()、提交与复制出的文本都带着 Sidecar 解析的语法。显示文本与序列化文本不同，所以是 DecoratorNode 而不是 token 模式的
// 文本节点：文本节点的选区偏移按显示文本计算，覆写文本内容会让部分选中时的切片错位。
// EditorState JSON 中保存 id 与 title；缺少任一个时导入抛错（草稿按损坏处理）。
import { $applyNodeReplacement, DecoratorNode, type LexicalNode, type NodeKey, type SerializedLexicalNode, type Spread } from 'lexical'
import { chipClass } from './file-reference-node.ts'

export type SerializedSessionReferenceNode = Spread<{ id: string; title: string }, SerializedLexicalNode>

export class SessionReferenceNode extends DecoratorNode<null> {
  __id: string
  __title: string

  static override getType(): string {
    return 'session-reference'
  }

  static override clone(node: SessionReferenceNode): SessionReferenceNode {
    return new SessionReferenceNode(node.__id, node.__title, node.__key)
  }

  static override importJSON(json: SerializedSessionReferenceNode): SessionReferenceNode {
    if (typeof json.id !== 'string' || json.id === '' || typeof json.title !== 'string' || json.title === '')
      throw new Error('session-reference node without an id or a title')
    return $createSessionReferenceNode(json.id, json.title)
  }

  constructor(id = '', title = '', key?: NodeKey) {
    super(key)
    this.__id = id
    this.__title = title
  }

  override exportJSON(): SerializedSessionReferenceNode {
    return { ...super.exportJSON(), type: 'session-reference', version: 1, id: this.__id, title: this.__title }
  }

  override createDOM(): HTMLElement {
    const element = document.createElement('span')
    element.classList.add(...chipClass)
    element.dataset.sessionReference = this.__id
    element.textContent = `@${this.__title}`
    return element
  }

  override updateDOM(): false {
    return false
  }

  override getTextContent(): string {
    return `@session:${this.__id}`
  }

  // 方向键直接越过 chip，不停在没有视觉反馈的节点选区上（与 File Reference 节点的手感一致）。
  override isKeyboardSelectable(): boolean {
    return false
  }
}

export function $createSessionReferenceNode(id: string, title: string): SessionReferenceNode {
  return $applyNodeReplacement(new SessionReferenceNode(id, title))
}

export function $isSessionReferenceNode(node: LexicalNode | null | undefined): node is SessionReferenceNode {
  return node instanceof SessionReferenceNode
}
