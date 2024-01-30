import React, { useCallback, useState } from 'react';
import { Card, Text, IconButton, Avatar } from 'react-native-paper';
import { useLiveQuery } from 'electric-sql/react';
import { useElectric } from './ElectricProvider';
import ConfirmationDialog from './ConfirmationDialog';
import { View } from 'react-native';
import { Link } from 'expo-router';


const MemberCard = ({
  memberId,
  editable = false,
  onPress
} : {
  memberId: string,
  editable?: boolean,
  onPress?: () => void,
}) => {
  const [ dialogVisible, setDialogVisible ] = useState(false)
  const { db } = useElectric()!
  const { results: member } = useLiveQuery(db.member.liveUnique({
    include: {
      family: {
        select: {
          name: true,
          creator_user_id: true
        }
      }
    },
    where: {
      member_id: memberId
    }
  }))

  const onRemoveFromFamily = useCallback(() => db.member.delete({
    where: {
      member_id: memberId
    }
  }), [ memberId ])

  if (!member) return null
  const isFamilyCreator = member.user_id == member.family.creator_user_id;
  return (
    <Card mode="elevated" onPress={onPress}>
      <Card.Title
        title={member.name}
        subtitle={`Joined on: ${member.created_at.toLocaleDateString()}`}
        left={(_) => <Avatar.Text
          size={32}
          label={member.name
            .split(' ')
            .map((w: string) => w[0])
            .slice(0, 2)
            .join('')}
          />
        }
        right={(_) => 
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          { editable && 
            <Link href={`/family/${member.family_id}/member/${memberId}/edit`} asChild>
              <IconButton icon="pencil" />
            </Link>
          }
          { isFamilyCreator ?
            <Text variant="labelSmall" style={{ marginRight: 12 }}>
              Owner
            </Text> :
            <IconButton icon="account-remove" onPress={() => setDialogVisible(true)} />
          }
          </View>
        }
      />
      <ConfirmationDialog
        visible={dialogVisible}
        title="Remove member from family"
        body={`Are you sure you want to remove ${member.name} from ${member.family.name}?`}
        onDismiss={() => setDialogVisible(false)}
        onConfirm={() => {
          onRemoveFromFamily()
          setDialogVisible(false)
        }}
        />
    </Card>
  )
}

export default MemberCard;