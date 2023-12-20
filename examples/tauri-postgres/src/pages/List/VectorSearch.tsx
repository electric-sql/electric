import { invoke } from '@tauri-apps/api'
// import Issue from '../Issue'

export async function embedIssue(issue: string): Promise<string> {
    return invoke("tauri_embed_issue", {text: issue});
}

// export function vectorSearch(query?: string): Issue[] {

//   return Issue[];
// }

export async function chat(question: string, context?: string): Promise<string> {
  return invoke("tauri_chat", {question: question, context: context ?? ""});
}
