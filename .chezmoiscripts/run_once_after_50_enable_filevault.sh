#!/bin/sh
set -eu

if /usr/bin/fdesetup isactive; then
  echo "FileVault is already enabled."
  exit 0
fi

state_dir="$HOME/Library/Application Support/Dotfiles"
state_file="$state_dir/filevault-recovery-key.plist"
daemon_label="com.fred.dotfiles.filevault-recovery-key-escrow"
daemon_script="/Library/Application Support/Dotfiles/escrow-filevault-recovery-key.sh"
daemon_plist="/Library/LaunchDaemons/$daemon_label.plist"

mkdir -p "$state_dir"
chmod 700 "$state_dir"

# A deferred enablement obtains the user's password at their next login instead
# of requiring it during `chezmoi apply`. The daemon below waits for macOS to
# write the recovery key, adds it to 1Password, then removes the local copy.
sudo /usr/bin/install -d -m 700 "/Library/Application Support/Dotfiles"
sudo /usr/bin/tee "$daemon_script" >/dev/null <<EOF
#!/bin/sh
set -eu

state_file='$state_file'
daemon_label='$daemon_label'
console_user=\$(/usr/bin/stat -f '%Su' /dev/console)

[ "\$console_user" != "root" ]
[ "\$console_user" != "loginwindow" ]
[ -r "\$state_file" ]

recovery_key=\$(/usr/libexec/PlistBuddy -c 'Print :RecoveryKey' "\$state_file" 2>/dev/null) || exit 0
[ -n "\$recovery_key" ]

if [ -x /opt/homebrew/bin/op ]; then
  op=/opt/homebrew/bin/op
elif [ -x /usr/local/bin/op ]; then
  op=/usr/local/bin/op
else
  exit 0
fi

user_id=\$(/usr/bin/id -u "\$console_user")
computer_name=\$(/usr/sbin/scutil --get ComputerName 2>/dev/null || /bin/hostname)

# Running in the logged-in user's bootstrap context lets the 1Password CLI use
# the signed-in desktop app. A failure is retried by launchd and leaves the
# recovery plist in its owner-only directory.
/bin/launchctl asuser "\$user_id" /usr/bin/sudo -u "\$console_user" "\$op" item create \\
  --vault Personal \\
  --category Password \\
  --title "FileVault Recovery Key — \$computer_name" \\
  "password=\$recovery_key" >/dev/null

/bin/rm -f "\$state_file"
/bin/rm -f "$daemon_script" "$daemon_plist"
/bin/launchctl bootout "system/\$daemon_label" 2>/dev/null || true
EOF
sudo /usr/sbin/chown root:wheel "$daemon_script"
sudo /bin/chmod 700 "$daemon_script"

sudo /usr/bin/tee "$daemon_plist" >/dev/null <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$daemon_label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$daemon_script</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>60</integer>
</dict>
</plist>
EOF
sudo /usr/sbin/chown root:wheel "$daemon_plist"
sudo /bin/chmod 644 "$daemon_plist"
sudo /bin/launchctl bootstrap system "$daemon_plist"

echo "FileVault will be enabled at your next login. Its recovery key will be saved to 1Password's Personal vault."
sudo /usr/bin/fdesetup enable \
  -user "$USER" \
  -defer "$state_file" \
  -forceatlogin 0 \
  -dontaskatlogout
