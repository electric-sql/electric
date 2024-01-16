import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/tauri";
import { embedIssue } from "../../utils/vectorSearch";
import { Issue, useElectric } from "../../electric";
import classNames from "classnames";

function Chat() {
  const [question, setQuestion] = useState<string>("");
  const [answer, setAnswer] = useState<string[]>([]);
  const [working, setWorking] = useState<boolean>(false);
  const { db } = useElectric()!;

  const doChat = async () => {
    setWorking(true);
    setAnswer([]);
    const embedding = await embedIssue(question ?? "");
    const issues = await db.raw({
      sql: `
        SELECT title, description
        FROM issue INNER JOIN document ON document.issue_id = issue.id
        ORDER BY document.embeddings <=> '${embedding}'
        LIMIT 5;
      `,
    });
    const context = issues
      .map((issue: any) => `${issue.title}\n${issue.description}`)
      .join("\n\n\n");
    console.log("startChat", { question: question, context: context ?? "" });
    invoke("start_chat", { question: question, context: context ?? "" });
  };

  const stopChat = async () => {
    setWorking(false);
    console.log("stopChat");
    invoke("stop_chat");
  };

  useEffect(() => {
    let unListenChatToken: null | (() => void) = null;
    let unListenChatFinished: null | (() => void) = null;
    let ignore = false;

    const init = async () => {
      unListenChatToken = await listen("chatToken", (event) => {
        if (ignore) return;
        console.log("chatToken received", event);
        // setAnswer([...answer, event.payload as string]);
        setAnswer((answer) => [...answer, event.payload as string]);
      });
      unListenChatFinished = await listen("chatFinished", (event) => {
        if (ignore) return;
        console.log("chatFinished received", event);
        setWorking(false);
      });
      if (ignore) {
        unListenChatToken?.();
        unListenChatToken = null;
        unListenChatFinished?.();
        unListenChatFinished = null;
      }
    };

    init();

    return () => {
      ignore = true;
      unListenChatToken?.();
      unListenChatToken = null;
      unListenChatFinished?.();
      unListenChatFinished = null;
    };
  }, []);

  const answerText = answer.join(" ") + (working ? "..." : "");
  const paragraphs = answerText.split("\n");

  return (
    <div className="flex flex-col flex-grow items-center">
      <div className="h-full p-5 max-w-prose min-w-prose prose w-full">
        {paragraphs.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </div>
      <div className="w-full flex items-center justify-between flex-shrink-0 pl-6 pr-6 border-t border-gray-200 py-2">
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
          className={classNames(
            "flex-shrink-0 bg-gray-100 border-0 rounded px-2 py-1.5 ms-2 flex items-center justify-center",
            {
              "opacity-50": working,
            }
          )}
          style={{ height: 36, width: 60 }}
          onClick={doChat}
          disabled={working}
        >
          {working ? (
            <svg
              className="animate-spin h-5 w-5 text-black"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
          ) : (
            "Ask"
          )}
        </button>
        <button
          className={classNames(
            "flex-shrink-0 bg-gray-100 border-0 rounded px-2 py-1.5 ms-2",
            {
              "opacity-50": !working,
            }
          )}
          style={{ height: 36 }}
          onClick={stopChat}
          disabled={!working}
        >
          Stop
        </button>
      </div>
    </div>
  );
}

export default Chat;
