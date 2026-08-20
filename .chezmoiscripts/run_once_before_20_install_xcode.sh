#!/bin/sh
set -eu

if ! command -v xcodes >/dev/null 2>&1; then
  echo "xcodes must be installed by the pre-Xcode Homebrew phase." >&2
  exit 1
fi

# `--latest` deliberately excludes prerelease/beta Xcode versions.
xcodes install --latest --experimental-unxip

# xcodes installs versioned app bundles (for example, Xcode-26.0.app). Select
# the bundle it just installed so xcrun, xcodebuild, and other CLI tools use it.
xcode_app=$( 
  /usr/bin/find /Applications -maxdepth 1 -type d -name 'Xcode*.app' -print |
    /usr/bin/xargs -I{} /usr/bin/stat -f '%m %N' '{}' |
    /usr/bin/sort -nr |
    /usr/bin/head -n 1 |
    /usr/bin/sed 's/^[0-9][0-9]* //'
)

if [ -z "$xcode_app" ]; then
  echo "No Xcode application was found after xcodes completed." >&2
  exit 1
fi

sudo xcode-select --switch "$xcode_app/Contents/Developer"
sudo xcodebuild -runFirstLaunch
sudo xcodebuild -license accept
