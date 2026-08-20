#!/bin/sh
set -eu

chflags nohidden "$HOME/Library"

defaults write com.apple.dock autohide -bool true
defaults write com.apple.dock showhidden -bool true
defaults write com.apple.dock orientation -string left

defaults write com.apple.finder ShowExternalHardDrivesOnDesktop -bool true
defaults write com.apple.finder ShowHardDrivesOnDesktop -bool true
defaults write com.apple.finder ShowMountedServersOnDesktop -bool true
defaults write com.apple.finder ShowRemovableMediaOnDesktop -bool true

defaults write com.apple.desktopservices DSDontWriteNetworkStores -bool true
defaults write -g com.apple.swipescrolldirection -bool false

killall Dock 2>/dev/null || true
killall Finder 2>/dev/null || true
