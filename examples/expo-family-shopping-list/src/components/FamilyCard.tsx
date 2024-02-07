import deepEqual from 'deep-equal';
import { Link, router } from 'expo-router';
import React, { memo, useState } from 'react';
import { View } from 'react-native';
import { Card, IconButton, Text } from 'react-native-paper';

import ConfirmationDialog from './ConfirmationDialog';
import { Family, Member } from '../generated/client';

interface MembershipWithFamily extends Member {
  family: Pick<Family, 'creator_user_id' | 'name' | 'image_base_64'>;
}

const FamilyCard = ({
  membership,
  onLeave,
}: {
  membership: MembershipWithFamily;
  onLeave: (memberId: string) => void;
}) => {
  const [exitDialogVisible, setExitDialogVisible] = useState(false);
  const onCardPressed = () => router.push(`/family/${membership.family_id}`);
  const isFamilyCreator = membership.user_id === membership.family.creator_user_id;
  return (
    <Card mode="elevated" onPress={onCardPressed}>
      {membership.family.image_base_64 && (
        <Card.Cover source={{ uri: membership.family.image_base_64 }} />
      )}
      <Card.Title
        title={membership.family.name}
        subtitleNumberOfLines={2}
        subtitle={`Joined on ${membership.created_at.toLocaleDateString()}`}
        right={(_) => (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Link href={`/family/${membership.family_id}/edit`} asChild>
              <IconButton icon="pencil" />
            </Link>

            {isFamilyCreator ? (
              <Text variant="labelSmall" style={{ marginRight: 12 }}>
                Owner
              </Text>
            ) : (
              <IconButton
                icon="account-multiple-remove"
                onPress={() => setExitDialogVisible(true)}
              />
            )}
          </View>
        )}
      />

      <ConfirmationDialog
        visible={exitDialogVisible}
        title="Leave family"
        body={`Are you sure you want to leave ${membership.family.name}?`}
        onDismiss={() => setExitDialogVisible(false)}
        onConfirm={() => {
          onLeave(membership.member_id);
          setExitDialogVisible(false);
        }}
      />
    </Card>
  );
};

export default memo(FamilyCard, deepEqual);
