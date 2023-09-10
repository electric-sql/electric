import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import type { Extensions } from '@tiptap/core'
import EditorMenu from './EditorMenu'
import { useEffect, useRef } from 'react'

interface EditorProps {
  value: string
  onChange: (value: string) => void
  className?: string
  placeholder?: string
}

const Editor = ({
  value,
  onChange,
  className = '',
  placeholder,
}: EditorProps) => {
  const editorProps = {
    attributes: {
      class: className,
    },
  }
  const markdownValue = useRef<string | null>(null)

  const extensions: Extensions = [StarterKit, Markdown]

  const editor = useEditor({
    extensions,
    editorProps,
    content: value || undefined,
    onUpdate: ({ editor }) => {
      markdownValue.current = editor.storage.markdown.getMarkdown()
      onChange(markdownValue.current || '')
    },
  })

  useEffect(() => {
    if (editor && markdownValue.current !== value) {
      editor.commands.setContent(value)
    }
  }, [value])

  if (placeholder) {
    extensions.push(
      Placeholder.configure({
        placeholder,
      })
    )
  }

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

export default Editor
