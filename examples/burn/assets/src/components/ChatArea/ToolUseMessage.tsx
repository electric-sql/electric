import type { FC } from 'react'
import type { EventResult, UserBadgeColor } from '../../types'

import SystemMessage from './SystemMessage'
import TextMessage from './TextMessage'

import AskUserAboutThemselves from './ToolUseMessages/AskUserAboutThemselves'
import ExtractFacts from './ToolUseMessages/ExtractFacts'
import RoastUser from './ToolUseMessages/RoastUser'

type ComponentProps = {
  event: EventResult
}
type ComponentMapping = Record<string, FC<ComponentProps>>

const textMessageMapping: ComponentMapping = {
  ask_user_about_themselves: AskUserAboutThemselves,
  roast_user: RoastUser,
}

const systemMessageMapping: ComponentMapping = {
  extract_facts: ExtractFacts,
}

interface Props {
  event: EventResult
  userBadgeColor: UserBadgeColor
  userName: string
}

function ToolUseMessage({ event, userName, userBadgeColor }: Props) {
  const tool_use = event.data.name as string

  const TextMessageContents = textMessageMapping[tool_use]
  if (TextMessageContents !== undefined) {
    return (
      <TextMessage
        event={event}
        label={tool_use}
        userName={userName}
        userBadgeColor={userBadgeColor}
      >
        <TextMessageContents event={event} />
      </TextMessage>
    )
  }

  const SystemMessageContents = systemMessageMapping[tool_use]
  if (SystemMessageContents !== undefined) {
    return (
      <SystemMessage
        event={event}
        userName={userName}
        userBadgeColor={userBadgeColor}
      >
        <SystemMessageContents event={event} />
      </SystemMessage>
    )
  }

  return null
}

export default ToolUseMessage
