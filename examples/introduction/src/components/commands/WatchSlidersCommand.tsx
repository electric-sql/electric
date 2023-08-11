import React from 'react'
import { useCommandCreds } from './CommandCreds'
import RenderCode from './RenderCode'

const WatchSlidersCommand = () => {
  const { demoName, sessionId } = useCommandCreds()!

  const code = `
SELECT value from sliders
  WHERE electric_user_id = '${sessionId}'
    AND demo_name = '${demoName}'; \\watch 1.0
  `.trim()

  return (
    <RenderCode>{code}</RenderCode>
  )
}

export default WatchSlidersCommand
