import React, { forwardRef, useCallback, useState } from 'react';
import { Card, IconButton, Text } from 'react-native-paper';
import { useLiveQuery } from 'electric-sql/react';
import { useElectric } from './ElectricProvider';
import ConfirmationDialog from './ConfirmationDialog';
import { View } from 'react-native';
import { Link } from 'expo-router';


const FamilyCard = forwardRef(({
  memberId,
  onPress
} : {
  memberId: string,
  onPress?: () => void,
}, _) => {
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
  const isFamilyCreator = membership.user_id == membership.family.creator_user_id;
  return (
    <Card mode="elevated" onPress={onPress}>
      <Card.Title
        title={membership.family.name}
        subtitleNumberOfLines={2}
        subtitle={`Joined on ${membership.created_at.toLocaleDateString()}`}
        right={(_) =>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Link href={`/family/${membership.family_id}/edit`} asChild>
              <IconButton icon="pencil" />
            </Link>
            
            { isFamilyCreator ?
              <Text variant="labelSmall" style={{ marginRight: 12 }}>
                Owner
              </Text>
              :
              <IconButton
                icon="account-multiple-remove" 
                onPress={() => setExitDialogVisible(true)}
              />
            }
          </View>
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
})

export default FamilyCard