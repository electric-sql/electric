import React, { useEffect, useState } from 'react'
import { Controlled as CodeMirrorControlled } from 'react-codemirror2'
import { ToolbarTabsProps } from '../tabs'

export default function ShapesTab({
  dbName,
  api,
}: ToolbarTabsProps): JSX.Element {
  const [shapes, setShapes] = useState<string[]>(
    api.getSatelliteShapeSubscriptions(dbName),
  )

  useEffect(() => {
    // periodically refresh shape subscriptions
    const interval = setInterval(
      () => setShapes(api.getSatelliteShapeSubscriptions(dbName)),
      1000,
    )
    return () => clearInterval(interval)
  }, [dbName, api])

  return (
    <div>
      <CodeMirrorControlled
        value={shapes.join('\n')}
        onBeforeChange={(_editor, _data, _value) => {}}
        options={{
          readOnly: true,
          tabSize: 4,
          mode: 'text',
          theme: 'material',
          lineNumbers: false,
        }}
      />
    </div>
  )
}
