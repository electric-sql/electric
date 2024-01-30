import React, { useCallback } from 'react';
import { Card, IconButton, Avatar } from 'react-native-paper';
import { useLiveQuery } from 'electric-sql/react';
import { useElectric } from './ElectricProvider';


const MemberCard = ({
  memberId,
  onPress
} : {
  memberId: string,
  onPress?: () => void,
}) => {
  const { db } = useElectric()!
  const { results: member } = useLiveQuery(db.member.liveUnique({
    where: {
      member_id: memberId
    }
  }))

  if (!member) return null
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
      />
    </Card>
  )
}

export default MemberCard;