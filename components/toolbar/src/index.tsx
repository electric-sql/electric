import React, { useEffect, useState, useCallback } from 'react'
import ReactDOM from 'react-dom/client'

import '@radix-ui/themes/styles.css'
import '@glideapps/glide-data-grid/dist/index.css'

import 'codemirror/lib/codemirror.css'
import 'codemirror/theme/material.css'
import 'codemirror/mode/sql/sql'
import './index.css'

import logo from './logo.svg'
import { Theme, Button, Box, Flex, Select, Text, Card } from '@radix-ui/themes'

import ToolbarTabs from './tabs'
import { ToolbarInterface } from './api/interface'
import { Toolbar } from './api/toolbar'
import {
  getToolbarElem,
  getToolbarTemplate,
  TOOLBAR_ELEMENT_ID,
  TOOLBAR_CONTAINER_ID,
} from './utils/portal'
import { ElectricClient } from 'electric-sql/client/model'

import { Registry, GlobalRegistry } from 'electric-sql/satellite'

export type ToolbarProps = {
  api: ToolbarInterface
}

function ElectricToolbar({ api }: ToolbarProps) {
  const [hidden, setHidden] = useState(true)
  const [appearance] = useState<'light' | 'dark'>('dark')
  const [dbNames, setDbNames] = useState<Array<string>>([])
  const [dbName, setDbName] = useState('')

  const onToggle = useCallback(() => setHidden((hidden) => !hidden), [])

  useEffect(() => {
    const names = api.getSatelliteNames()
    setDbNames(names)
    if (names.length > 0) {
      setDbName(names[0])
    }
  }, [])

  return (
    <Theme
      asChild
      appearance={appearance}
      accentColor="teal"
      grayColor="sage"
      panelBackground="solid"
    >
      <Box
        id="electric-core"
        width={hidden ? '400px' : '100%'}
        height="fit-content"
        minHeight="auto"
        p="2"
        style={{
          backgroundColor: 'transparent',
          float: 'right',
          boxSizing: 'border-box',
        }}
      >
        <Card style={{ pointerEvents: 'auto' }}>
          <Flex justify="between" flexGrow="1">
            <Flex align="center" gap="1">
              <img src={logo} width="30px" height="30px" alt="logo" />
              <Text>ElectricSQL Debug Tools</Text>
            </Flex>
            <Flex gap="2">
              {!hidden && (
                <Select.Root
                  defaultValue={dbNames[0]}
                  onValueChange={setDbName}
                >
                  <Select.Trigger />
                  <Select.Content container={getToolbarElem()}>
                    {dbNames.map((name) => (
                      <Select.Item key={name} value={name}>
                        {name}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              )}
              <Button onClick={onToggle}>{hidden ? 'SHOW' : 'HIDE'}</Button>
            </Flex>
          </Flex>
          {!hidden && <ToolbarTabs dbName={dbName} api={api} />}
        </Card>
      </Box>
    </Theme>
  )
}

export function clientApi(registry: GlobalRegistry | Registry) {
  return new Toolbar(registry)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function addToolbar(electric: ElectricClient<any>) {
  const toolbarApi = clientApi(electric.registry)

  const containerDiv = document.createElement('div')
  containerDiv.id = TOOLBAR_CONTAINER_ID
  containerDiv.setAttribute(
    'style',
    'position: fixed; bottom: 0; right: 0; width: 100%; pointer-events: none; z-index: 99999;',
  )

  // create shadow dom from container element
  const shadow = containerDiv.attachShadow({ mode: 'open' })

  // add styles to shadow dom
  const template = getToolbarTemplate()
  shadow.appendChild(template.content)

  // render toolbar to shadow dom
  const toolbarDiv = document.createElement('div')
  toolbarDiv.id = TOOLBAR_ELEMENT_ID
  toolbarDiv.setAttribute('style', 'height: 100%; width: 100%;')
  shadow.appendChild(toolbarDiv)
  ReactDOM.createRoot(toolbarDiv).render(<ElectricToolbar api={toolbarApi} />)

  // attach to body
  document.body.appendChild(containerDiv)
}
