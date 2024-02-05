import React, { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { TextInput, Button } from 'react-native-paper'
import DropDown from 'react-native-paper-dropdown'
import { useElectric } from './ElectricProvider'
import { useLiveQuery } from 'electric-sql/react'
import { useAuthenticatedUser } from './AuthProvider'

const FamilyDropDown = ({
  selectedFamilyId,
  onChange,
} : {
  selectedFamilyId: string,
  onChange?: (familyId: string) => void,
}) => {
  const [ visible, setVisible ] = useState(false)
  const [ familyId, setFamilyId ] = useState(selectedFamilyId)
  const userId = useAuthenticatedUser()
  if (!userId) return null
  
  const { db } = useElectric()!
  const { results: memberships = [] } = useLiveQuery(db.member.liveMany({
      include: {
        family: {
          select: {
            name: true,
          }
        }
      },
      where: {
        user_id: userId
      }
    }
  ))

  const familyOptions = useMemo(() => memberships.map((membership) => ({
    label: membership.family.name,
    value: membership.family_id
  })), [ memberships ])

  useEffect(() => {
    setFamilyId(selectedFamilyId)
  }, [selectedFamilyId])

  return (
    <View pointerEvents={familyOptions.length > 1 ? 'auto' : 'none'}>
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
}

export default FamilyDropDown;