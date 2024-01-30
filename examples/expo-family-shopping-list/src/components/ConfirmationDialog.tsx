import React from 'react';
import { Portal, Dialog, Text, Button } from 'react-native-paper';

const ConfirmationDialog = ({
  visible,
  title,
  body,
  onConfirm,
  onDismiss
} : {
  visible: boolean,
  title: string,
  body: string,
  onConfirm: () => void,
  onDismiss?: () => void,
}) => {
  return (
    <>
      <Portal>
        <Dialog
          visible={visible}
          onDismiss={onDismiss}>
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              {body}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={onDismiss}>
              Cancel
            </Button>
            <Button onPress={onConfirm}>
              Confirm
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  )
}

export default ConfirmationDialog