import React from 'react'
import { useCommandCreds } from './CommandCreds'
import RenderCode from './RenderCode'

const InsertItemsCommand = () => {
  const { demoName, demoId, sessionId } = useCommandCreds()!

  const ts = `${Date.now()}`
  const code = `
INSERT INTO items (
    id,
    demo_id,
    demo_name,
    electric_user_id,
    inserted_at
  )
  VALUES (
    gen_random_uuid(),
    '${demoId}',
    '${demoName}',
    '${sessionId}',
    '${ts}'
  );
  `.trim()

  return (
    <RenderCode>{code}</RenderCode>
  )
}

export default InsertItemsCommand
