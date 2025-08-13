import { Dialog, Flex, Text, Button } from '@radix-ui/themes'

interface UserRemoveModalProps {
  isOpen: boolean
  userName: string
  onConfirm: () => void
  onCancel: () => void
}

function ThreadRemoveUserModal({
  isOpen,
  userName,
  onConfirm,
  onCancel,
}: UserRemoveModalProps) {
  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Content style={{ maxWidth: 450 }}>
        <Dialog.Title>Remove User</Dialog.Title>
        <Text as="p" size="2" mb="4">
          Remove <strong>{userName}</strong> from thread? Are you sure?
        </Text>
        <Flex gap="3" mt="4" justify="end">
          <Button variant="soft" color="gray" onClick={onCancel}>
            No
          </Button>
          <Button variant="solid" color="red" onClick={onConfirm}>
            Yes
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}

export default ThreadRemoveUserModal
