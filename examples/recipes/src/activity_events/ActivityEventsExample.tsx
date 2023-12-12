import {
  Badge, Button, Container, Grid,
  IconButton, Popover, Slide, Snackbar
} from "@mui/material"
import { NavigationBar } from "../components/NavigationBar"
import { Close, Notifications } from "@mui/icons-material"
import { useState } from "react"

export const ActivityEventsExample = () => {
  return (
    <div>
      <NavigationBar title="Activity Events" items={
        [
          <NotificationPopover key="notifications" />
        ]
      }/>
      <Container maxWidth="sm">
        <Grid container justifyContent="center" alignItems="center">
          <Grid item>
            <Button variant="outlined">
              Primary
            </Button>
          </Grid>
        </Grid>

      <NotificationToast />
      </Container>
    </div>
  )

}

const NotificationPopover = () => {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <IconButton color="inherit" onClick={(e) => setAnchorEl(e.currentTarget)}>
        <Badge
          color="secondary"
          variant="dot"
          invisible={false}
        >
          <Notifications />
        </Badge>
      </IconButton>
      <Popover
        open={anchorEl !== null}
        onClose={() => setAnchorEl(null)}
        anchorEl={anchorEl}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'left',
        }}
        >
      </Popover>
    </>
  )
}

const NotificationToast = () => {
  const [open, setOpen] = useState(false);
  const [messageInfo, setMessageInfo] = useState<string | undefined>(
    undefined,
  );

  const handleClose = (_event: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') {
      return;
    }
    setOpen(false);
  };

  const handleExited = () => {
    setMessageInfo(undefined);
  };

  return (
    <Snackbar
        open={open}
        onClose={handleClose}
        TransitionComponent={(props) => <Slide {...props} direction="up" />}
        TransitionProps= {{ onExited: handleExited }}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'center'
        }}
        message={messageInfo}
        action={
          <>
            <Button color="secondary" size="small" onClick={handleClose}>
              UNDO
            </Button>
            <IconButton
              aria-label="close"
              color="inherit"
              sx={{ p: 0.5 }}
              onClick={handleClose}
            >
              <Close />
            </IconButton>
          </>
        }
      />
  )
}