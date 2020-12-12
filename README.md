# Dot Files
Dot files used across all my macOS installs. They're expected to be installed through [strap](https://github.com/MikeMcQuaid/strap).

On Apple Silicon, run strap through `arch`:

```
$ /usr/bin/arch -x86_64 /bin/bash -c strap.sh
```

# Configuration

- `KEEP_XCODE_PREFERENCES=YES` prevents strap from overidding the preexisting Xcode preferences.
- `KEEP_VSCODE_PREFERENCES=YES` prevents strap from overidding the preexisting VS Code preferences.
- `SSH_KEY_EMAIL=<email>` sets a custom email for the generated SSH key.

# Manual Steps
1. Import iTerms color themes & profile.
2. Change Spotlight's shortcut to **⇧⌘Space**.

# License
These dot files are licensed under the MIT License. See `LICENSE` for more details.
