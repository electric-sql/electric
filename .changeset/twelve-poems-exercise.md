---
"create-electric-app": patch
---

Improved starter such that several (independent) Electric projects can run concurrently.
The starter now has 2 modes: fast mode and interactive mode.
In fast mode, you can provide the app name and optional ports for Electric and the webserver as arguments.
In interactive mode, the script will prompt for an app name and ports (suggesting defaults).
Port clashes are now detected and reported to the user.
The user can change the ports the app uses by invoking 'yarn ports:configure'.
Also fixes the bug where all Electric applications would forward requests to the esbuild server that is running on port 8000 instead of their own esbuild server.
