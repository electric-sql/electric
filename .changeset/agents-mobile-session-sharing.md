---
"@electric-ax/agents-mobile": patch
"@electric-ax/agents-server-ui": patch
---

Bring session sharing to mobile (desktop `ShareEntityDialog` parity, mobile-first UX):

- **Share session screen.** A modal route opened from the session menu's new **Share** entry. It exposes a link pill (abbreviated session web URL — one tap opens the native OS share sheet, which includes Copy), a "People with access" list with a pinned Owner row, a Google-Drive-style "General access" section for the workspace-wide *All users* grant, and a search-first "Add people" section. Roles (View / Chat / Manage, same permission sets and glyphs as desktop) commit per row through a bottom-sheet picker with a destructive *Remove access* action — no deferred Grant/Update button. The grant list comes from the manage-protected REST `GET /grants` endpoint (the synced effective-permissions shape is scoped to the current principal, so it can't list other people's access); non-managers still get the link actions and see a manage-required message below.
- **Copy session id.** The session menu's status header and the long-press row sheet now render the id with a tap-to-copy affordance (copy→check icon swap, mirroring the desktop entity header), via a new `expo-clipboard` dependency.
- **Session web links.** `sessionWebUrl()` builds `{serverUrl}/__agent_ui/#/entity/{id}` directly — targeting the web UI path rather than the server root, whose absolute-path redirect would drop a Cloud `/t/<service-id>/v1` tenant prefix.

The desktop dialog's `userDisplay()`/`initials()` helpers move into `agents-server-ui`'s `lib/userDisplay.ts` so mobile deep-imports them instead of duplicating. Grant-diffing, removal, and access-model grouping logic is ported into a pure, unit-tested `entityGrants` module. No server API changes.
