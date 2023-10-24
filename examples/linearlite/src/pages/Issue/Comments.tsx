import { useLiveQuery } from 'electric-sql/react'
import { v4 as uuidv4 } from 'uuid'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useElectric, type Issue } from '../../electric'
import Editor from '../../components/editor/Editor'
import Avatar from '../../components/Avatar'
import { formatDate } from '../../utils/date'
import { showWarning } from '../../utils/notification'

export interface CommentsProps {
  issue: Issue
}

function Comments({ issue }: CommentsProps) {
  const { db } = useElectric()!
  const [newCommentBody, setNewCommentBody] = useState<string>('')
  const { results: comments } = useLiveQuery(
    db.comment.liveMany({
      where: {
        issue_id: issue.id,
      },
      orderBy: {
        created_at: 'asc',
      },
    })
  )

  const commentList = () => {
    if (comments && comments.length > 0) {
      return comments.map((comment) => (
        <div
          key={comment.id}
          className="flex flex-col w-full p-3 mb-3 bg-white rounded shadow-sm border"
        >
          <div className="flex items-center mb-2">
            <Avatar name={comment.username} />
            <span className="ms-2 text-sm text-gray-400">
              {comment.username}
            </span>
            <span className=" ms-auto text-sm text-gray-400 ml-2">
              {formatDate(comment.created_at)}
            </span>
          </div>
          <div className="mt-2 text-md prose w-full max-w-full">
            <ReactMarkdown>{comment.body}</ReactMarkdown>
          </div>
        </div>
      ))
    }
  }

  const handlePost = () => {
    if (!newCommentBody) {
      showWarning(
        'Please enter a comment before submitting',
        'Comment required'
      )
      return
    }

    db.comment.create({
      data: {
        id: uuidv4(),
        issue_id: issue.id,
        body: newCommentBody,
        created_at: new Date(),
        username: 'testuser',
      },
    })
    setNewCommentBody('')
  }

  return (
    <>
      {commentList()}
      <Editor
        className="prose w-full max-w-full mt-2 font-normal appearance-none min-h-12 p-3 text-md shadow-sm rounded border border-gray-200 editor"
        value={newCommentBody}
        onChange={(val) => setNewCommentBody(val)}
        placeholder="Add a comment..."
      />
      <div className="flex w-full py-3">
        <button
          className="px-3 ml-auto text-white bg-indigo-600 rounded hover:bg-indigo-700 h-7"
          onClick={handlePost}
        >
          Post Comment
        </button>
      </div>
    </>
  )
}

export default Comments
