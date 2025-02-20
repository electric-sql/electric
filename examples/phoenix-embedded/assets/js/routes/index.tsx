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

type ToDo = {
  id: string
  title: string
  completed: boolean
  created_at: number
}

export default function Index() {
  const csrfToken = (document.head.querySelector(
    "meta[name~=csrf-token][content]"
  ) as HTMLMetaElement)!.content
  const { data: todos } = useShape<ToDo>({
    url: new URL(`/shapes/todos`, window.location.href).href,
    params: {
      // table: `todos`,
      // source_id: import.meta.env.VITE_ELECTRIC_SOURCE_ID,
      // source_secret: import.meta.env.VITE_ELECTRIC_SOURCE_SECRET,
    },
  })
  todos.sort((a, b) => a.created_at - b.created_at)

  const [inputEnabled, setInputEnabled] = useState(false)

  const onTodoClicked = useCallback(async (todo: ToDo) => {
    console.log(`completed`)
    await fetch(new URL(`/api/todos/${todo.id}`, window.location.href).href, {
      method: `PUT`,
      headers: {
        "content-type": `application/json`,
        accept: `application/json`,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        todo: { completed: !todo.completed },
      }),
    })
  }, [])

  const onTodoDeleted = useCallback(async (todo: ToDo) => {
    console.log(`deleted`)
    await fetch(new URL(`/api/todos/${todo.id}`, window.location.href).href, {
      method: `DELETE`,
      headers: {
        "x-csrf-token": csrfToken,
        accept: `application/json`,
      },
    })
  }, [])

  return (
    <Container size="1">
      <Flex gap="5" mt="5" direction="column">
        <Flex align="center" justify="center">
          <img src={logo} width="32px" alt="logo" />
          <Heading ml="1">Electric To-Dos</Heading>
          <Box width="32px" />
        </Flex>

        <Flex gap="3" direction="column">
          {todos.length === 0 ? (
            <Flex justify="center">
              <Text>No to-dos to show - add one!</Text>
            </Flex>
          ) : (
            todos.map((todo) => {
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
              new URL(`/api/todos`, window.location.href).href,
              {
                method: `POST`,
                headers: {
                  "content-type": `application/json`,
                  accept: `application/json`,
                  "x-csrf-token": csrfToken,
                },
                body: JSON.stringify({ todo: { id, title: formData.todo } }),
              }
            )
            console.log({ res })
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
