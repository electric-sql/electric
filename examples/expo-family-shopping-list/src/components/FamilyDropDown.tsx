import { useLiveQuery } from 'electric-sql/react';
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import DropDown from 'react-native-paper-dropdown';

import { useAuthenticatedUser } from './AuthProvider';
import { useElectric } from './ElectricProvider';

const FamilyDropDown = ({
  selectedFamilyId,
  onChange,
  disabled = false,
}: {
  selectedFamilyId: string;
  onChange?: (familyId: string) => void;
  disabled?: boolean;
}) => {
  const [visible, setVisible] = useState(false);
  const [familyId, setFamilyId] = useState(selectedFamilyId);
  const userId = useAuthenticatedUser()!;
  const { db } = useElectric()!;
  const { results: memberships = [] } = useLiveQuery(
    db.member.liveMany({
      include: {
        family: {
          select: {
            name: true,
          },
        },
      },
      where: {
        user_id: userId,
      },
    }),
  );

  const familyOptions = useMemo(
    () =>
      memberships.map((membership) => ({
        label: membership.family.name,
        value: membership.family_id,
      })),
    [memberships],
  );

  useEffect(() => {
    setFamilyId(selectedFamilyId);
  }, [selectedFamilyId]);

  const enableDropdown = familyOptions.length > 1 && !disabled;
  return (
    <View style={{ pointerEvents: enableDropdown ? 'auto' : 'none' }}>
      <DropDown
        label="Family"
        mode="outlined"
        visible={visible}
        showDropDown={() => setVisible(true)}
        onDismiss={() => setVisible(false)}
        value={familyId}
        setValue={(newFamilyId: string) => onChange?.(newFamilyId)}
        list={familyOptions}
      />
    </View>
  );
};

export default FamilyDropDown;
