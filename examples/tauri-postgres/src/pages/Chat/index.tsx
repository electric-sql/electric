import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/tauri";
import { BsXLg as CloseIcon } from "react-icons/bs";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { embedIssue } from "../../utils/vectorSearch";
import { Issue, useElectric } from "../../electric";
import { Spinner } from "../../components/Spinner";
import classNames from "classnames";

function Chat() {
  const [question, setQuestion] = useState<string>("");
  const [answer, setAnswer] = useState<string[]>([]);
  const [working, setWorking] = useState<boolean>(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { db } = useElectric()!;
  const navigate = useNavigate();

  const doChat = async () => {
    setWorking(true);
    setAnswer([]);
    const embedding = await embedIssue(question ?? "");
    const issues = await db.raw({
      sql: `
        SELECT title, description
        FROM issue INNER JOIN document ON document.issue_id = issue.id
        ORDER BY document.embeddings <=> '${embedding}'
        LIMIT 50;
      `,
    });
    setIssues(issues as Issue[]);
    const context = issues
      .map(
        (issue: any) =>
          `# [${issue.title}](/issue/${issue.id})\n${issue.description}`
      )
      .join("\n---\n\n")
      .slice(0, 4 * 4096 - (100 + question.length)); // 4096 token limit, tokens are ~4 bytes
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
        setAnswer((answer) => [...answer, event.payload as string]);
        scrollDown();
      });
      unListenChatFinished = await listen("chatFinished", (event) => {
        if (ignore) return;
        console.log("chatFinished received", event);
        setWorking(false);
        scrollDown();
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

  const handleClose = () => {
    if (window.history.length > 2) {
      navigate(-1);
    }
    navigate("/");
  };

  const scrollDown = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  const answerText = answer.join("") + (working ? "..." : "");

  return (
    <div className="flex flex-col flex-grow items-center max-h-full">
      <div className="flex flex-col w-full">
        <div className="flex flex-shrink-0 pr-6 border-b border-gray-200 h-14 pl-3 md:pl-5 lg:pl-9">
          <div className="flex items-center font-semibold ms-2">
            Linearlite Chat
          </div>
          <div className="flex items-center ms-auto">
            <button
              className="ms-auto p-2 rounded hover:bg-gray-100"
              onClick={handleClose}
            >
              <CloseIcon size={14} />
            </button>
          </div>
        </div>
      </div>
      <div className="flex flex-row flex-grow items-center h-full w-full overflow-y-auto">
        <div
          className="flex flex-col flex-grow items-center h-full w-full overflow-y-auto"
          ref={scrollRef}
        >
          <div className="h-full p-5 max-w-prose min-w-prose prose w-full">
            {working && answer.length === 0 ? (
              <div className="opacity-50">
                <Spinner />
              </div>
            ) : (
              <ReactMarkdown>{answerText}</ReactMarkdown>
            )}
          </div>
        </div>
        {issues?.length && (
          <div
            className="flex flex-col flex-shrink-0 py-5 px-2 h-full border-l border-gray-200  overflow-y-auto  opacity-70"
            style={{
              minWidth: 200,
              maxWidth: 200,
            }}
          >
            <h4
              className="text-gray-500 text-sm font-semibold mb-2"
              style={{ lineHeight: 1.2 }}
            >
              Referenced Issues
            </h4>
            <div className="flex flex-col flex-grow">
              {issues.map((issue, i) => (
                <div className="flex flex-col mb-2 text-sm">
                  <span
                    onClick={() => navigate(`/issue/${issue.id}`)}
                    className="cursor-pointer no-wrap overflow-hidden font-medium line-clamp-1 overflow-ellipsis"
                  >
                    {i + 1}. {issue.title}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
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
          {working ? <Spinner /> : "Ask"}
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
