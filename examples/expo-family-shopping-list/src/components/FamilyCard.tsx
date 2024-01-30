import React, { useCallback, useState } from 'react';
import { Card, IconButton, Portal, Dialog, Text, Button } from 'react-native-paper';
import { useLiveQuery } from 'electric-sql/react';
import { useElectric } from './ElectricProvider';


const FamilyCard = ({
  memberId,
  onPress
} : {
  memberId: string,
  onPress?: () => void,
}) => {
  const [ exitDialogVisible, setExitDialogVisible ] = useState(false)
  const { db } = useElectric()!
  const { results: membership } = useLiveQuery(db.member.liveUnique({
    include: {
      family: {
        include: {
          member: {
            select: {
              member_id: true
            }
          }
        }
      },
    },
    where: {
      member_id: memberId
    }
  }))

  const onLeave = useCallback(() => db.member.delete({
    where: {
      member_id: memberId
    }
  }), [ memberId ])

  if (!membership) return null
  return (
    <>
      <Card mode="elevated" onPress={onPress}>
        <Card.Title
          title={membership.family.name}
          subtitleNumberOfLines={2}
          subtitle={`Joined on ${membership.created_at.toLocaleDateString()}`}
          right={(_) =>
            membership.user_id == membership.family.creator_user_id ?
            null :
            <IconButton
              icon="account-remove" 
              onPress={() => setExitDialogVisible(true)}
              />
          }
        />
      </Card>
      <Portal>
        <Dialog
          visible={exitDialogVisible}
          onDismiss={() => setExitDialogVisible(false)}>
          <Dialog.Title>Leave family</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              {`Are you sure you want to leave ${membership.family.name}?`}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setExitDialogVisible(false)}>
              Cancel
            </Button>
            <Button onPress={() =>  {
              onLeave()
              setExitDialogVisible(false)
            }}>
              Leave
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  )
}

export default FamilyCard