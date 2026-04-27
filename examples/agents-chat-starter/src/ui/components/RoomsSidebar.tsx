import { useState } from 'react'
import {
  Box,
  Flex,
  Text,
  TextField,
  IconButton,
  Heading,
} from '@radix-ui/themes'
import { PlusIcon } from '@radix-ui/react-icons'

interface Room {
  id: string
  name: string
  agentCount: number
}

export function RoomsSidebar({
  rooms,
  activeRoomId,
  onSelectRoom,
  onCreateRoom,
  creating,
}: {
  rooms: Room[]
  activeRoomId: string | null
  onSelectRoom: (id: string) => void
  onCreateRoom: (name: string) => void
  creating: boolean
}) {
  const [newName, setNewName] = useState(``)

  const handleCreate = () => {
    onCreateRoom(newName.trim())
    setNewName(``)
  }

  return (
    <Flex direction="column" className="panel panel-rooms">
      <Box px="3" py="3">
        <Heading size="3">Agents Chat</Heading>
      </Box>

      <Box flexGrow="1" px="2" className="panel-scroll">
        <Box px="1" pb="1">
          <Text size="1" color="gray" weight="medium">
            Rooms
          </Text>
        </Box>
        {rooms.map((room) => {
          const active = room.id === activeRoomId
          return (
            <Box
              key={room.id}
              px="2"
              py="1"
              className={`list-row ${active ? `list-row-active` : ``}`}
              onClick={() => onSelectRoom(room.id)}
            >
              <Text size="2" weight={active ? `bold` : `regular`}>
                <Text color="gray"># </Text>
                {room.name}
              </Text>
            </Box>
          )
        })}
        {rooms.length === 0 && (
          <Box px="2" py="2">
            <Text size="1" color="gray">
              No rooms yet
            </Text>
          </Box>
        )}
      </Box>

      <Flex px="3" py="2" gap="2" align="center" className="panel-footer">
        <Box flexGrow="1">
          <TextField.Root
            size="2"
            placeholder="New room..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === `Enter`) handleCreate()
            }}
          />
        </Box>
        <IconButton
          size="1"
          variant="soft"
          onClick={handleCreate}
          disabled={creating}
        >
          <PlusIcon />
        </IconButton>
      </Flex>
    </Flex>
  )
}
