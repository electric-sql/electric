import { invoke } from '@tauri-apps/api'

export async function embedIssue(issue: string): Promise<string> {
    return invoke("tauri_embed_issue", {text: issue});
}

export async function chat(question: string, context?: string): Promise<string> {
  return invoke("tauri_chat", {question: question, context: context ?? ""});
}
