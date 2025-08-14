import { useState } from 'react'
import { makeStyles } from '@griffel/react'
import { Flex, Box } from '@radix-ui/themes'

import ThreadEditForm from './MainThread/ThreadEditForm'
import ThreadEditTopBar from './MainThread/ThreadEditTopBar'
import ThreadTopBar from './MainThread/ThreadTopBar'

import ChatArea from './ChatArea'

const useClasses = makeStyles({
  content: {
    flex: 1,
    overflow: 'hidden',
  },
})

type Props = {
  threadId: string
}

function MainThread({ threadId }: Props) {
  const classes = useClasses()
  const [isEditing, setIsEditing] = useState(false)

  return (
    <Flex direction="column" height="100%">
      {isEditing ? (
        <>
          <Box>
            <ThreadEditTopBar onClose={() => setIsEditing(false)} />
          </Box>
          <Box className={classes.content}>
            <ThreadEditForm threadId={threadId} />
          </Box>
        </>
      ) : (
        <>
          <Box>
            <ThreadTopBar
              threadId={threadId}
              onEditClick={() => setIsEditing(true)}
            />
          </Box>
          <Box className={classes.content}>
            <ChatArea threadId={threadId} />
          </Box>
        </>
      )}
    </Flex>
  )
}

export default MainThread
