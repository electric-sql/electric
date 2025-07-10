import { useCallback, useState } from "react"
import {
  Container,
  Flex,
  Checkbox,
  Heading,
  Text,
  TextField,
  Card,
  Button,
  Box,
} from "@radix-ui/themes"
import logo from "../assets/logo.svg"
import { useShape } from "@electric-sql/react"
import { v4 as uuidv4 } from "uuid"
import React from "react"

type ToDo = {
  id: string
  title: string
  completed: boolean
  inserted_at: string
  updated_at: string
}

export default function Index() {
  const { data: todos, isLoading, error } = useShape<ToDo>({
    url: `${import.meta.env.VITE_ELECTRIC_URL}/shapes/todos`,
    offset: "-1",
  })
  
  // Debug logging
  console.log('Electric URL:', import.meta.env.VITE_ELECTRIC_URL)
  console.log('Shape loading state:', { isLoading, error, todosCount: todos?.length })
  
  if (error) {
    console.error('Shape error:', error)
  }

  // Manual fetch test to debug CORS
  React.useEffect(() => {
    const testFetch = async () => {
      try {
        console.log('🧪 Testing manual fetch...')
        const response = await fetch(`${import.meta.env.VITE_ELECTRIC_URL}/shapes/todos?offset=-1`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
        })
        console.log('📋 Response status:', response.status)
        console.log('📋 Response headers:')
        for (const [key, value] of response.headers.entries()) {
          console.log(`  ${key}: ${value}`)
        }
        
        // Specifically check for Electric headers
        const electricOffset = response.headers.get('electric-offset')
        const electricHandle = response.headers.get('electric-handle')
        const electricSchema = response.headers.get('electric-schema')
        
        console.log('🔍 Electric headers check:')
        console.log('  electric-offset:', electricOffset)
        console.log('  electric-handle:', electricHandle) 
        console.log('  electric-schema:', electricSchema)
        
        if (!electricOffset || !electricHandle || !electricSchema) {
          console.error('❌ Missing Electric headers! This indicates a CORS configuration issue.')
          console.log('💡 Checking access-control-expose-headers:', response.headers.get('access-control-expose-headers'))
        } else {
          console.log('✅ All Electric headers are accessible!')
        }
        
        const data = await response.json()
        console.log('📋 Response data:', data)
      } catch (err) {
        console.error('❌ Manual fetch failed:', err)
      }
    }
    
    testFetch()
  }, [])
  
  // Convert shape data to typed todos
  const typedTodos: ToDo[] = todos?.map(row => ({
    id: row.id as string,
    title: row.title as string,
    completed: String(row.completed) === 'true' || String(row.completed) === 't',
    inserted_at: row.inserted_at as string,
    updated_at: row.updated_at as string,
  })) || []
  
  const sortedTodos = typedTodos.sort((a, b) => 
    new Date(a.inserted_at).getTime() - new Date(b.inserted_at).getTime()
  )

  const [inputEnabled, setInputEnabled] = useState(false)

  const onTodoClicked = useCallback(async (todo: ToDo) => {
    console.log(`updating todo completion status`)
    await fetch(
      `${import.meta.env.VITE_SERVER_URL}/todos/${todo.id}`,
      {
        method: `PUT`,
        headers: {
          "Content-Type": `application/json`,
        },
        body: JSON.stringify({
          completed: !todo.completed,
        }),
      }
    )
  }, [])

  const onTodoDeleted = useCallback(async (todo: ToDo) => {
    console.log(`deleting todo`)
    await fetch(
      `${import.meta.env.VITE_SERVER_URL}/todos/${todo.id}`,
      {
        method: `DELETE`,
      }
    )
  }, [])

  return (
    <Container size="1">
      <Flex gap="5" mt="5" direction="column">
        <Flex align="center" justify="center">
          <img src={logo} width="32px" alt="logo" />
          <Heading ml="1">Phoenix Electric To-Dos</Heading>
          <Box width="32px" />
        </Flex>

        <Flex gap="3" direction="column">
          {sortedTodos.length === 0 ? (
            <Flex justify="center">
              <Text>No to-dos to show - add one!</Text>
            </Flex>
          ) : (
            sortedTodos.map((todo) => {
              return (
                <Card key={todo.id} onClick={() => onTodoClicked(todo)}>
                  <Flex gap="2" align="center" justify="between">
                    <Text as="label">
                      <Flex gap="2" align="center">
                        <Checkbox checked={todo.completed} />
                        {todo.title}
                      </Flex>
                    </Text>
                    <Button
                      onClick={(e) => {
                        e.stopPropagation()
                        onTodoDeleted(todo)
                      }}
                      variant="ghost"
                      ml="auto"
                      style={{ cursor: `pointer` }}
                    >
                      X
                    </Button>
                  </Flex>
                </Card>
              )
            })
          )}
        </Flex>
        <form
          style={{ width: `100%` }}
          onSubmit={async (event) => {
            event.preventDefault()
            if (!inputEnabled) return
            const id = uuidv4()
            const formElem = event.target as HTMLFormElement
            const formData = Object.fromEntries(new FormData(formElem))
            formElem.reset()

            const res = await fetch(
              `${import.meta.env.VITE_SERVER_URL}/todos`,
              {
                method: `POST`,
                headers: {
                  "Content-Type": `application/json`,
                },
                body: JSON.stringify({ id, title: formData.todo }),
              }
            )
            console.log({ res })
            setInputEnabled(false)
          }}
        >
          <Flex direction="row">
            <TextField.Root
              onChange={(e) => setInputEnabled(e.currentTarget.value !== ``)}
              type="text"
              name="todo"
              placeholder="New Todo"
              mr="1"
              style={{ width: `100%` }}
            />
            <Button type="submit" disabled={!inputEnabled}>
              Add
            </Button>
          </Flex>
        </form>
      </Flex>
    </Container>
  )
}
