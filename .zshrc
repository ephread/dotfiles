
# ZSH Sanity

# # no c-s/c-q output freezing
# setopt noflowcontrol
# # allow expansion in prompts
# setopt prompt_subst
# # this is default, but set for share_history
# setopt append_history
# # save each command's beginning timestamp and the duration to the history file
# setopt extended_history
# # display PID when suspending processes as well
# setopt longlistjobs
# # try to avoid the 'zsh: no matches found...'
# setopt nonomatch
# # report the status of backgrounds jobs immediately
# setopt notify
# # whenever a command completion is attempted, make sure the entire command path
# # is hashed first.
# setopt hash_list_all
# # not just at the end
# setopt completeinword
# # use zsh style word splitting
# setopt noshwordsplit
# # allow use of comments in interactive code
# setopt interactivecomments

# ZSH Configuration

autoload -U compinit && compinit
zmodload -i zsh/complist

zstyle ':completion:*' menu select

bindkey -M menuselect '^[[Z' reverse-menu-complete
bindkey '^[[1;3D' backward-word
bindkey '^[[1;3C' forward-word

# Homebrew

eval $(/opt/homebrew/bin/brew shellenv)

# Starship
eval "$(starship init zsh)"
export STARSHIP_CONFIG=~/.starship.toml

# asdf
source "$(brew --prefix asdf)/libexec/asdf.sh"
source "$HOME/.asdf/plugins/golang/set-env.zsh"


# Z & Antidote
source "$(brew --prefix)/etc/profile.d/z.sh"
source "$(brew --prefix antidote)/share/antidote/antidote.zsh"
antidote load ${ZDOTDIR:-$HOME}/.zsh_plugins.txt

# Android Stuff

#export android-studio="open -a /Applications/Android\ Studio.app"
#export JAVA_HOME="/Applications/Android Studio.app/Contents/jre/Contents/Home"
#export ANDROID_SDK_ROOT="$HOME/Library/Android/sdk"

# PATHs
export PATH="/usr/local/opt/gnu-getopt/bin:$PATH"
export PATH="$HOME/.local/bin:$PATH"

# GPG
export GPG_TTY=$(tty)
