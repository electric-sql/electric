import { View } from "react-native"

const FlatListSeparator = ({ gap = 12 } : { gap?: number }) => {
  return <View style={{ height: gap }} />
}

export default FlatListSeparator