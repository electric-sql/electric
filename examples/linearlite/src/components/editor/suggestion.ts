import { ReactRenderer } from '@tiptap/react'
import tippy from 'tippy.js'
import { Instance as TippyInstance } from 'tippy.js'
import { SuggestionOptions } from '@tiptap/suggestion'
import { MentionOptions } from '@tiptap/extension-mention'
import { Electric } from '../../generated/client'
import MentionList from './MentionList.jsx'

export interface suggestedIssue {
  id: string
  title: string
}

export const suggestionConfig: (
  electricClient: Electric
) => Partial<SuggestionOptions> = (electricClient) => ({
  char: '#',
  items: async ({ query }) => {
    const db = electricClient.db

    return (await db.issue.findMany({
      select: {
        id: true,
        title: true,
        created: true,
      },
      where: {
        title: {
          contains: query,
        },
      },
      orderBy: {
        created: 'desc',
      },
      take: 5,
    })) as suggestedIssue[]
  },

  render: () => {
    let component: ReactRenderer<unknown, unknown>
    let popup: TippyInstance[]

    return {
      onStart: (props) => {
        component = new ReactRenderer(MentionList, {
          props,
          editor: props.editor,
        })

        if (!props.clientRect) {
          return
        }

        popup = tippy('body', {
          getReferenceClientRect: () => props.clientRect!()!,
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start',
        })
      },

      onUpdate(props) {
        component.updateProps(props)

        if (!props.clientRect) {
          return
        }

        popup[0].setProps({
          getReferenceClientRect: () => props.clientRect!()!,
        })
      },

      onKeyDown(props) {
        if (props.event.key === 'Escape') {
          popup[0].hide()

          return true
        }

        return component.ref.onKeyDown(props)
      },

      onExit() {
        popup[0].destroy()
        component.destroy()
      },
    }
  },
})

export const mentionConfig: (
  electricClient: Electric
) => Partial<MentionOptions> = (electricClient) => ({
  renderLabel: ({ node }) => {
    return `#${node.attrs.id.slice(0, 8)}: ${node.attrs.label?.slice(0, 20)}${
      node.attrs.label?.length > 20 ? '...' : ''
    }`
  },
  HTMLAttributes: {
    class: 'text-indigo-600 bg-gray-100 rounded px-1 py-0.5',
  },
  suggestion: suggestionConfig(electricClient),
})
