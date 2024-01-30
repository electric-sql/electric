import React, { useCallback, useState } from 'react';
import { Card, IconButton } from 'react-native-paper';
import { useLiveQuery } from 'electric-sql/react';
import { useElectric } from './ElectricProvider';
import ConfirmationDialog from './ConfirmationDialog';


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

      <ConfirmationDialog
        visible={exitDialogVisible}
        title="Leave family"
        body={`Are you sure you want to leave ${membership.family.name}?`}
        onDismiss={() => setExitDialogVisible(false)}
        onConfirm={() => {
          onLeave()
          setExitDialogVisible(false)
        }}
      />
    </Card>
  )
}

export default FamilyCard