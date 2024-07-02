import React from 'react';
import { SvgProps } from 'react-native-svg';

import Logo from '../../assets/logo.svg';

const AppLogo = (props: SvgProps) => {
  return <Logo {...props} />;
};

export default AppLogo;
