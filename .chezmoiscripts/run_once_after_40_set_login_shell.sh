#!/bin/sh
set -eu

current_shell=$(/usr/bin/dscl . -read "/Users/$USER" UserShell | /usr/bin/awk '{print $2}')
if [ "$current_shell" != "/bin/zsh" ]; then
  sudo chsh -s /bin/zsh "$USER"
fi
