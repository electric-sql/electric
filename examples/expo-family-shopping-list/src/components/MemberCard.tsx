import deepEqual from 'deep-equal';
import { Link } from 'expo-router';
import React, { memo, useState } from 'react';
import { View } from 'react-native';
import { Card, Text, IconButton, Avatar } from 'react-native-paper';

import ConfirmationDialog from './ConfirmationDialog';
import { Family, Member } from '../generated/client';

interface MembershipWithFamily extends Member {
  family: Pick<Family, 'creator_user_id' | 'name'>;
}

const MemberCard = ({
  membership,
  editable = false,
  onRemoved,
}: {
  membership: MembershipWithFamily;
  editable?: boolean;
  onRemoved: (memberId: string) => void;
}) => {
  const [dialogVisible, setDialogVisible] = useState(false);
  const isFamilyCreator = membership.user_id === membership.family.creator_user_id;
  const handleRemoved = () => onRemoved(membership.member_id);
  return (
    <Card mode="elevated">
      <Card.Title
        title={membership.name}
        subtitle={`Joined on: ${membership.created_at.toLocaleDateString()}`}
        left={(_) =>
          membership.image_base_64 ? (
            <Avatar.Image size={42} source={{ uri: membership.image_base_64 }} />
          ) : (
            <Avatar.Text
              size={42}
              label={membership.name
                .split(' ')
                .map((w: string) => w[0].toUpperCase())
                .slice(0, 2)
                .join('')}
            />
          )
        }
        right={(_) => (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {editable && (
              <Link
                href={`/family/${membership.family_id}/membership/${membership.member_id}/edit`}
                asChild>
                <IconButton icon="pencil" />
              </Link>
            )}
            {isFamilyCreator ? (
              <Text variant="labelSmall" style={{ marginRight: 12 }}>
                Owner
              </Text>
            ) : (
              <IconButton icon="account-remove" onPress={() => setDialogVisible(true)} />
            )}
          </View>
        )}
      />
      <ConfirmationDialog
        visible={dialogVisible}
        title="Remove membership from family"
        body={`Are you sure you want to remove ${membership.name} from ${membership.family.name}?`}
        onDismiss={() => setDialogVisible(false)}
        onConfirm={() => {
          handleRemoved();
          setDialogVisible(false);
        }}
      />
    </Card>
  );
};

export default memo(MemberCard, deepEqual);
