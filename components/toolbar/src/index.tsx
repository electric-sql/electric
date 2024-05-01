import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'

import '@radix-ui/themes/styles.css'

import 'codemirror/lib/codemirror.css'
import 'codemirror/theme/material.css'
import 'codemirror/mode/sql/sql'
import style from './index.module.css'
import './index.module.css'

import logo from './logo.svg'
import { Theme, Button, Box, Flex, Select, Text } from '@radix-ui/themes'

import ToolbarTabs from './tabs'
import { ToolbarInterface } from './api/interface'
import { Toolbar } from './api/toolbar'
import { ElectricClient } from 'electric-sql/client/model'

import { Registry, GlobalRegistry } from 'electric-sql/satellite'

export type ToolbarProps = {
  api: ToolbarInterface
}

function ElectricToolbar({ api }: ToolbarProps) {
  const [hidden, setHidden] = useState(true)
  const [dbNames, setDbNames] = useState<Array<string>>([])
  const [dbName, setDbName] = useState('')

  useEffect(() => {
    const names = api.getSatelliteNames()
    setDbNames(names)
    if (names.length > 0) {
      setDbName(names[0])
    }
  }, [])

  return (
    <Theme asChild appearance="dark">
      <Box
        width={hidden ? '400px' : '100%'}
        height={hidden ? 'fit-content' : '40vh'}
        minHeight="auto"
        style={{ float: 'right' }}
      >
        <Flex justify="between" flexGrow="1">
          <Flex align="center" gap="1">
            <img src={logo} className={style.toolbarLogo} alt="logo" />
            <Text>ElectricSQL Debug Tools</Text>
          </Flex>
          <Flex gap="1">
            {!hidden && (
              <Select.Root defaultValue={dbNames[0]} onValueChange={setDbName}>
                <Select.Trigger />
                <Select.Content>
                  {dbNames.map((name) => (
                    <Select.Item key={name} value={name}>
                      {name}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            )}
            <Button onClick={() => setHidden(!hidden)}>
              {hidden ? 'SHOW' : 'HIDE'}
            </Button>
          </Flex>
        </Flex>
        {!hidden && <ToolbarTabs dbName={dbName} api={api} />}
      </Box>
    </Theme>
  )
}

export function clientApi(registry: GlobalRegistry | Registry) {
  return new Toolbar(registry)
}

export function addToolbar(electric: ElectricClient<any>) {
  const toolbarApi = clientApi(electric.registry)
  const toolbarDiv = document.createElement('div')
  toolbarDiv.setAttribute('class', style.electricToolbar)
  document.body.appendChild(toolbarDiv)
  ReactDOM.createRoot(toolbarDiv).render(<ElectricToolbar api={toolbarApi} />)
}
