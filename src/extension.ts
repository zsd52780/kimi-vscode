import * as path from 'path';
import * as vscode from 'vscode';
import { ChatMessage } from './kimiClient';
import { ChatPanel } from './chatPanel';

type TaskKind = 'explain' | 'review' | 'refactor' | 'tests';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('kimiK3.openChat', () => {
      ChatPanel.createOrShow(context).reveal();
    }),
    vscode.commands.registerCommand('kimiK3.clearConversation', () => {
      if (ChatPanel.current) {
        ChatPanel.current.clearConversation();
      }
    }),
    vscode.commands.registerCommand('kimiK3.setApiKey', () => setApiKey(context)),
    vscode.commands.registerCommand('kimiK3.explainSelection', () =>
      runSelectionTask(context, 'explain')
    ),
    vscode.commands.registerCommand('kimiK3.reviewSelection', () =>
      runSelectionTask(context, 'review')
    ),
    vscode.commands.registerCommand('kimiK3.refactorSelection', () =>
      runSelectionTask(context, 'refactor')
    ),
    vscode.commands.registerCommand('kimiK3.generateTests', () =>
      runSelectionTask(context, 'tests')
    ),
    vscode.commands.registerCommand('kimiK3.askAboutFile', () => askAboutFile(context))
  );
}

export function deactivate(): void {}

async function setApiKey(context: vscode.ExtensionContext): Promise<void> {
  const current = (await context.secrets.get('kimiK3.apiKey')) ?? '';
  const value = await vscode.window.showInputBox({
    prompt: '输入 Kimi API Key（保存在 VS Code 安全存储中，不会写入设置文件）',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'sk-...',
    value: current,
  });
  if (value === undefined) {
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    await context.secrets.delete('kimiK3.apiKey');
    void vscode.window.showInformationMessage('已清除保存的 API Key。');
    return;
  }
  await context.secrets.store('kimiK3.apiKey', trimmed);
  void vscode.window.showInformationMessage('API Key 已保存。');
}

function buildTaskPrompt(kind: TaskKind, lang: string, file: string, code: string): string {
  const fenced = '```' + lang + '\n' + code + '\n```';
  switch (kind) {
    case 'explain':
      return `请解释下面这段 ${lang} 代码（文件：${file}）：它实现了什么功能、关键逻辑如何工作，以及有哪些值得注意的地方。\n\n${fenced}`;
    case 'review':
      return `请对下面这段 ${lang} 代码（文件：${file}）做代码审查：重点检查正确性、边界情况、性能、可读性和安全性，按严重程度列出问题并给出修改建议。\n\n${fenced}`;
    case 'refactor':
      return `请重构下面这段 ${lang} 代码（文件：${file}）：保持外部行为不变，提升可读性、可维护性和性能。请先给出重构后的完整代码，再简要说明改动理由。\n\n${fenced}`;
    case 'tests':
      return `请为下面这段 ${lang} 代码（文件：${file}）编写单元测试，覆盖主要功能和边界情况。请先说明建议使用的测试框架，再给出可运行的测试代码。\n\n${fenced}`;
  }
}

async function runSelectionTask(context: vscode.ExtensionContext, kind: TaskKind): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('请先打开一个文件。');
    return;
  }
  if (editor.selection.isEmpty) {
    void vscode.window.showWarningMessage('请先选中要处理的代码。');
    return;
  }

  const code = editor.document.getText(editor.selection);
  const lang = editor.document.languageId;
  const file = path.basename(editor.document.fileName);
  const prompt = buildTaskPrompt(kind, lang, file, code);
  const panel = ChatPanel.createOrShow(context);
  panel.startConversation([{ role: 'user', content: prompt }]);
}

async function askAboutFile(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('请先打开一个文件。');
    return;
  }
  const document = editor.document;
  const fileName = path.basename(document.fileName);
  const question = await vscode.window.showInputBox({
    prompt: `关于 ${fileName}，你想问什么？`,
    ignoreFocusOut: true,
  });
  if (!question || !question.trim()) {
    return;
  }

  const maxLength = 40000;
  let text = document.getText();
  if (text.length > maxLength) {
    text = text.slice(0, maxLength) + '\n\n…（文件内容过长，已截断）';
  }
  const prompt =
    `以下是文件 ${document.fileName} 的内容（${document.languageId}）：\n\n` +
    '```' +
    document.languageId +
    '\n' +
    text +
    '\n```\n\n我的问题是：' +
    question.trim();

  const panel = ChatPanel.createOrShow(context);
  panel.startConversation([{ role: 'user', content: prompt }]);
}
