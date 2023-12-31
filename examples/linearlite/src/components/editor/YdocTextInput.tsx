import { useMemo } from 'react'
import {
  useEditor,
  EditorContent,
  type Extensions,
  Extension,
} from '@tiptap/react'
import * as Y from 'yjs'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Placeholder from '@tiptap/extension-placeholder'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import { userColor } from '../../utils'

const TextDocument = Document.extend({
  content: 'block',
})

const ShiftEnter = Extension.create({
  addKeyboardShortcuts(this) {
    return {
      'Shift-Enter': () => true,
    }
  },
})

interface EditorProps {
  ydoc: Y.Doc
  field: string
  className?: string
  placeholder?: string
  collaborationProvider?: any
}

const YdocTextInput = ({
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

  const extensions: Extensions = useMemo(() => {
    return [
      TextDocument,
      Paragraph,
      Text,
      Collaboration.configure({
        document: ydoc,
        field,
      }),
      ShiftEnter,
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

  return <EditorContent editor={editor} />
}

export default YdocTextInput
