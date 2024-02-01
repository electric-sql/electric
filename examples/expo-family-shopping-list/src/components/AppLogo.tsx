import React from 'react';
import Logo from '../../assets/logo.svg'
import { SvgProps } from "react-native-svg";

const AppLogo = (props: SvgProps)=> {
  return (
    <Logo {...props} />
  )
}

export default AppLogo
