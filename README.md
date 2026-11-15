# Dotfiles

These macOS dotfiles are managed with [chezmoi](https://www.chezmoi.io/). This
repository is the chezmoi source directory and remains checked out at
`~/.dotfiles`.

## First-time setup

Install Homebrew, then install chezmoi with its [official installation
script](https://www.chezmoi.io/install/):

```sh
sh -c "$(curl -fsLS get.chezmoi.io)" -- -b "$HOME/.local/bin"
"$HOME/.local/bin/chezmoi" init --source="$HOME/.dotfiles"
"$HOME/.local/bin/chezmoi" diff
"$HOME/.local/bin/chezmoi" apply --verbose
```

The managed shell configuration adds `$HOME/.local/bin` to `PATH`, so later
invocations can use `chezmoi` directly.

Review the diff before applying: chezmoi will replace the legacy symlinks in
`$HOME` with managed files. Bootstrap runs in this order: pre-Xcode Homebrew
(only `xcodes`), the latest mainline Xcode, mise Ruby/Node plus
Bundler/CocoaPods, then post-Xcode Homebrew. The macOS script also unhides
`~/Library` and runs once. VS Code extensions run whenever their source list
changes and are skipped when `code` is unavailable.

The Xcode phase selects the freshly installed Xcode for command-line tools,
runs Xcode's first-launch setup, and accepts the developer license; it prompts
for Apple ID credentials and administrator access when needed. The one-time
macOS setup defers FileVault enablement to the next login. Once macOS generates
the personal recovery key, it is stored in the `Personal` 1Password vault and
the temporary local plist is removed. This requires 1Password to be signed in
and unlocked after that login.

## Layout

- `dot_*` files are deployed to `$HOME` with the leading dot restored. The
  `assets/Brewfile` uses `DOTFILES_BUNDLE_PHASE=pre|post` internally; without
  it, it installs the complete bundle.
- `private_Library` contains direct targets under `~/Library` for VS Code and
  Xcode.
- `assets/xcode/com.apple.dt.Xcode.plist` seeds Xcode preferences once per
  machine; later applies leave them unmanaged.
- `private_dot_config/ghostty` manages the Ghostty configuration and custom
  theme under `~/.config/ghostty`.
- `private_dot_config/mise/config.toml` makes the newest Ruby, Node.js, and
  command-line tools the global mise defaults.

After making a local target-file change, use `chezmoi add <file>`; review with
`chezmoi diff`, then commit the resulting source change.

# License
These dot files are licensed under the MIT License. See `LICENSE` for more details.
