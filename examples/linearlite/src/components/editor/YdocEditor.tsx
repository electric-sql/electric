import { useMemo } from 'react'
import {
  useEditor,
  EditorContent,
  BubbleMenu,
  type Extensions,
} from '@tiptap/react'
import * as Y from 'yjs'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Table from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import Mention from '@tiptap/extension-mention'
import EditorMenu from './EditorMenu'
import { userColor } from '../../utils'
import { mentionConfig } from './suggestion'
import { useElectric } from '../../electric'

interface EditorProps {
  ydoc: Y.Doc
  field: string
  className?: string
  placeholder?: string
  collaborationProvider?: any
}

const YdocEditor = ({
  ydoc,
  field = 'document',
  className = '',
  placeholder,
  collaborationProvider,
}: EditorProps) => {
  const editorProps = {
    attributes: {
      class: className,
    },
  }

  const electricClient = useElectric()!

  const extensions: Extensions = useMemo(() => {
    return [
      StarterKit.configure({
        history: false, // collaboration extension handles history
        heading: {
          levels: [2, 3, 4],
        }
      }),
      Table,
      TableRow,
      TableHeader,
      TableCell,
      Collaboration.configure({
        document: ydoc,
        field,
      }),
      Mention.configure(mentionConfig(electricClient)),
      // Register the collaboration cursor extension
      ...(collaborationProvider
        ? [
            CollaborationCursor.configure({
              provider: collaborationProvider,
              user: {
                // TODO: get user info from auth
                name: 'testuser',
                color: userColor('testuser'),
              },
            }),
          ]
        : []),
      ...(placeholder
        ? [
            Placeholder.configure({
              placeholder,
            }),
          ]
        : []),
    ]
  }, [ydoc, field, placeholder])

  const editor = useEditor({
    extensions,
    editorProps,
  })

  return (
    <>
      <EditorContent editor={editor} />
      {editor && (
        <BubbleMenu editor={editor}>
          <EditorMenu editor={editor} />
        </BubbleMenu>
      )}
    </>
  )
}

export default YdocEditor
