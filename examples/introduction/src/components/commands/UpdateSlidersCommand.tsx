import React from 'react'
import { useCommandCreds } from './CommandCreds'
import RenderCode from './RenderCode'

const UpdateSlidersCommand = () => {
  const { demoName, sessionId } = useCommandCreds()!

  const code = `
UPDATE sliders
  SET value = round(random() * 100)
  WHERE demo_name = '${demoName}'
    AND electric_user_id = '${sessionId}';
  `.trim()

  return (
    <RenderCode>{code}</RenderCode>
  )
}

export default UpdateSlidersCommand
