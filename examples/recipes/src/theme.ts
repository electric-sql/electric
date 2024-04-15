import { createTheme } from '@mui/material/styles'
const theme = createTheme({
  palette: {
    primary: {
      main: '#00b388',
      dark: '#009370',
      // darker: '#00b388',
      // darkest: '#009370',
      light: '#00e7b0',
      // lighter: '#00f1b8',
      // lightest: '#12ffc7',
    },
    secondary: {
      main: '#e8eaf0',
      dark: '#d2d4dc',
      // darker: '#bec0c8',
      // darkest: '#9ea0aa',
      light: '#e8eaf0',
      // lighter: '#e8eaf0',
      // lightest: '#e8eaf0',
    },
    background: {
      default: '#131517',
      paper: '#19181b',
    },
    text: {
      primary: '#e8eaf0',
      secondary: '#d2d4dc',
    },
    action: {
      active: '#00d2a0', // --electric-green
      hover: '#7e78db', // --lead-purple
      selected: '#d0bcff', // --script-purple
      disabled: '#242428', // --card-border
      disabledBackground: '#1d1c20', // --card-grey
    },
  },
  typography: {
    fontFamily: 'Roboto, sans-serif',
  },
})

export default theme
