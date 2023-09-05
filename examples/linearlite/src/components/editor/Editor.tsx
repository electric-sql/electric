import { EditorProvider, BubbleMenu } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import type { Editor as TipTapEditor, Extensions } from '@tiptap/core'
import EditorMenu from './EditorMenu'

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

  const extensions: Extensions = [StarterKit]

  if (placeholder) {
    extensions.push(
      Placeholder.configure({
        placeholder,
      })
    )
  }

  const onUpdate = ({ editor }: { editor: TipTapEditor }) => {
    const json = editor.getJSON()
    onChange(JSON.stringify(json))
  }

  return (
    <EditorProvider
      extensions={extensions}
      content={value ? JSON.parse(value) : undefined}
      editorProps={editorProps}
      onUpdate={onUpdate}
    >
      <BubbleMenu>
        <EditorMenu />
      </BubbleMenu>
    </EditorProvider>
  )
}

export default Editor
