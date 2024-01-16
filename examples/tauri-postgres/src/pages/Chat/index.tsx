import { useEffect, useRef, useState } from "react";
import { chat as callChatAPI, embedIssue } from '../../utils/vectorSearch'
import { Issue, useElectric } from "../../electric";

function Chat() {
  const [question, setQuestion] = useState<string>();
  const [answer, setAnswer] = useState<string>();
  const { db } = useElectric()!;

  const doChat = async () => {
    setAnswer("...");
    const embedding = await embedIssue(question ?? "");
    const issues = await db.raw({
      sql: `
        SELECT title, description
        FROM issue INNER JOIN document ON document.issue_id = issue.id
        ORDER BY document.embeddings <=> '${embedding}'
        LIMIT 5;
      `,
    });
    const context = issues.map((issue: any) => `${issue.title}\n${issue.description}`).join("\n\n\n");
    const response = await callChatAPI(question ?? "", context);
    setAnswer(response);
  }

  return (
    <div className="flex flex-col flex-grow">
      <div className="h-full">
        {answer}
      </div>
      <div className="flex items-center justify-between flex-shrink-0 pl-6 pr-6 border-t border-gray-200 py-2">
        <input
          type="search"
          placeholder="Ask a question"
          className="w-full bg-gray-100 border-0 rounded px-2 py-1.5"
          onChange={(e) => setQuestion(e.target.value)}
          value={question}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              doChat();
            }
          }}
        />
        <button
          className="flex-shrink-0 bg-gray-100 border-0 rounded px-2 py-1.5 ms-2"
          style={{ height: 36 }}
          onClick={doChat}
        >Ask</button>
      </div>
    </div>
  )
}

export default Chat