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
import EditorMenu from './EditorMenu'
import { useMemo } from 'react'

interface EditorProps {
  ydoc: Y.Doc
  field: string
  className?: string
  placeholder?: string
}

const YdocEditor = ({
  ydoc,
  field = 'document',
  className = '',
  placeholder,
}: EditorProps) => {
  const editorProps = {
    attributes: {
      class: className,
    },
  }

  const extensions: Extensions = useMemo(() => {
    return [
      StarterKit.configure({
        history: false, // collaboration extension handles history
      }),
      Table,
      TableRow,
      TableHeader,
      TableCell,
      Collaboration.configure({
        document: ydoc,
        field,
      }),
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
