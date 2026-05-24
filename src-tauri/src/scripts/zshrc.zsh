# husk-shell-integration (zshrc)
#
# Emits OSC 7 (cwd) + OSC 133 A/B/C/D (prompt-start / prompt-end / pre-exec /
# command-done-with-exit-code) so the host can detect command boundaries and
# track cwd without re-parsing the prompt. `status` is a read-only special in
# zsh, so we shadow $? into `_husk_ret`.
#
# Also bundles zsh-autosuggestions (MIT) and fzf key-bindings (MIT) so users
# get inline ghost-text autocomplete and fuzzy history search out of the box.

{
  _husk_user_zdotdir="${HUSK_USER_ZDOTDIR:-$HOME}"
  [ -f "$_husk_user_zdotdir/.zshrc" ] && source "$_husk_user_zdotdir/.zshrc"
  unset _husk_user_zdotdir
}

# ---------------------------------------------------------------------------
# Smart history, completions & bookmarks (before plugins so they can override)
# ---------------------------------------------------------------------------

# Directory bookmarks: `j <key>` jumps to a saved dir, `j .` goes back
# Usage: `j h` → home, `j d` → ~/Developer, `j t` → /tmp, `j .` → last dir
typeset -gA _husk_bookmarks
typeset -g _husk_last_dir="$PWD"
_husk_bookmarks=(
  [h]="$HOME"
  [d]="${HOME}/Developer"
  [t]="/tmp"
)
j() {
  local key="$1"
  if [[ -z "$key" ]]; then
    echo "Bookmarks:"
    for k v in "${(@kv)_husk_bookmarks}"; do echo "  $k → $v"; done
    return 0
  fi
  if [[ "$key" == "." ]]; then
    cd "$_husk_last_dir" 2>/dev/null || { echo "No last dir"; return 1; }
    return 0
  fi
  local target="${_husk_bookmarks[$key]}"
  if [[ -z "$target" ]]; then
    echo "Unknown bookmark: $key"
    echo "Bookmarks:"
    for k v in "${(@kv)_husk_bookmarks}"; do echo "  $k → $v"; done
    return 1
  fi
  _husk_last_dir="$PWD"
  cd "$target" 2>/dev/null || { echo "Cannot cd to: $target"; return 1; }
}

# Auto-save last dir before every cd
chpwd() {
  _husk_last_dir="$OLDPWD"
}

setopt HIST_IGNORE_ALL_DUPS      # Remove older duplicate entries
setopt HIST_SAVE_NO_DUPS         # Don't write duplicate entries to history file
setopt HIST_REDUCE_BLANKS        # Trim whitespace from commands
setopt HIST_VERIFY               # Show expanded history before executing
setopt SHARE_HISTORY             # Share history across all zsh sessions instantly
setopt EXTENDED_HISTORY          # Save timestamp and duration
HISTFILE="${HOME}/.zsh_history"
HISTSIZE=100000
SAVEHIST=100000

# ---------------------------------------------------------------------------
# Colorful defaults for common commands
# ---------------------------------------------------------------------------

export CLICOLOR=1
export LS_COLORS='di=34:ln=36:so=35:pi=33:ex=32:bd=34;46:cd=34;43:su=30;41:sg=30;46:tw=30;42:ow=30;43'
export GCC_COLORS='error=01;31:warning=01;35:note=01;36:caret=01;32:locus=01:quote=01'

alias grep='grep --color=auto'
alias diff='diff --color=auto'
alias ip='ip -color=auto' 2>/dev/null
alias dmesg='dmesg --color=always' 2>/dev/null

# Enable colors in less/man pages
export LESS='-R --mouse'
export LESS_TERMCAP_mb=$'\e[1;31m'   # blink -> bold red
export LESS_TERMCAP_md=$'\e[1;36m'   # bold -> bold cyan
export LESS_TERMCAP_me=$'\e[0m'      # reset
export LESS_TERMCAP_so=$'\e[1;44;33m' # standout -> yellow on blue
export LESS_TERMCAP_se=$'\e[0m'      # reset standout
export LESS_TERMCAP_us=$'\e[1;32m'   # underline -> bold green
export LESS_TERMCAP_ue=$'\e[0m'      # reset underline

# Colorful grep highlight
export GREP_COLORS='mt=1;31;48:fn=35:ln=32:se=36'

# Git colors (ensure they're on even if user hasn't set them)
command git config --global color.ui auto 2>/dev/null
command git config --global color.diff auto 2>/dev/null
command git config --global color.status auto 2>/dev/null
command git config --global color.branch auto 2>/dev/null
command git config --global color.interactive auto 2>/dev/null
command git config --global color.grep auto 2>/dev/null
command git config --global color.pager true 2>/dev/null

# Use bat as man pager if available (syntax-highlighted man pages)
if (( $+commands[bat] )); then
  export MANPAGER="sh -c 'col -bx | bat -l man -p'"
fi

# Use delta for git diff if available (side-by-side with syntax highlighting)
if (( $+commands[delta] )); then
  command git config --global core.pager delta 2>/dev/null
  command git config --global delta.side-by-side false 2>/dev/null
  command git config --global delta.line-numbers true 2>/dev/null
fi

# Minimal colored prompt fallback if user has no framework (oh-my-zsh, starship, etc.)
# Shows: cwd → git-branch $  with green/red $ based on exit code.
if [[ -z "$PS1" || "$PS1" == '%m%'#' || "$PS1" == '%n@%m%'#' || "$PS1" == '%#' ]]; then
  autoload -Uz vcs_info 2>/dev/null
  if (( $+functions[vcs_info] )); then
    zstyle ':vcs_info:git:*' formats '%F{yellow}(%b)%f '
    zstyle ':vcs_info:*' enable git
    precmd_vcs() { vcs_info }
    precmd_functions+=(precmd_vcs)
  fi
  PS1='%F{cyan}%~%f ${vcs_info_msg_0_}%F{%(?.green.red)}$%f '
fi

# Enable zsh completions with nice formatting
autoload -Uz compinit 2>/dev/null
if [[ -n "${ZDOTDIR}/.zcompdump"(#qN.mh+24) ]]; then
  compinit -d "${ZDOTDIR}/.zcompdump"
else
  compinit -C -d "${ZDOTDIR}/.zcompdump"
fi
zstyle ':completion:*' menu select
zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}' 'r:|=*' 'l:|=* r:|=*'
zstyle ':completion:*' list-colors "${(s.:.)LS_COLORS}"
zstyle ':completion:*' group-name ''
zstyle ':completion:*' verbose yes

# ---------------------------------------------------------------------------
# Bundled plugins (sourced after user .zshrc so user config takes precedence)
# ---------------------------------------------------------------------------

# Inline ghost-text suggestions (fish-style)
# Skip if user already has it loaded in their ~/.zshrc
if (( ! $+functions[_zsh_autosuggest_start] )) && [[ -f "${0:A:h}/zsh-autosuggestions.zsh" ]]; then
  ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE="fg=#555555"
  source "${0:A:h}/zsh-autosuggestions.zsh"
fi

# Real-time syntax highlighting (commands green, errors red, strings yellow, paths underlined)
# Skip if user already has it loaded in their ~/.zshrc
if (( ! $+functions[_zsh_highlight] )) && [[ -f "${0:A:h}/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh" ]]; then
  ZSH_HIGHLIGHT_HIGHLIGHTERS=(main brackets cursor)
  source "${0:A:h}/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh"
fi

# Fuzzy history search (Ctrl+R), file finder (Ctrl+T), cd navigator (Alt+C)
if (( $+commands[fzf] )) && [[ -f "${0:A:h}/fzf-key-bindings.zsh" ]]; then
  source "${0:A:h}/fzf-key-bindings.zsh"
fi

# Re-source guard within a single shell (e.g. user runs `source ~/.zshrc`).
# This is NOT exported, so each nested zsh installs its own hooks — desired,
# since every interactive shell needs its own prompt integration.
if [[ -z "$__HUSK_HOOKS_LOADED" ]]; then
  __HUSK_HOOKS_LOADED=1
  autoload -Uz add-zsh-hook 2>/dev/null

  # URL-encode $PWD byte-wise so multi-byte paths stay valid in the `file://`
  # URI emitted via OSC 7. `no_multibyte` forces ${s[i]} to index bytes (not
  # code points), and LC_ALL=C keeps the [a-zA-Z0-9...] class single-byte.
  _husk_urlencode() {
    emulate -L zsh
    setopt localoptions no_multibyte
    local LC_ALL=C s="$1" i byte
    for (( i=1; i<=${#s}; i++ )); do
      byte="${s[i]}"
      case "$byte" in
        [a-zA-Z0-9/._~-]) printf '%s' "$byte" ;;
        *) printf '%%%02X' "'$byte" ;;
      esac
    done
  }

  _husk_precmd() {
    local _husk_ret=$?
    printf '\e]133;D;%s\e\\' "$_husk_ret"
    printf '\e]7;file://%s%s\e\\' "${HOST}" "$(_husk_urlencode "$PWD")"
    # Re-inject prompt-end marker in case a framework rebuilt PS1 (p10k, starship).
    if [[ "$PS1" != *$'\e]133;B\e\\'* ]]; then
      PS1=$'%{\e]133;B\e\\%}'"$PS1"
    fi
    printf '\e]133;A\e\\'
  }

  _husk_preexec() {
    local cmd="$1"
    # Emit command text for alias tracking (stripped of leading/trailing whitespace)
    if [[ -n "${cmd// /}" ]]; then
      printf '\e]778;husk;cmd;%s\e\\' "${cmd//;/%3B}"
    fi
    printf '\e]133;C\e\\'
  }

  if (( $+functions[add-zsh-hook] )); then
    add-zsh-hook precmd _husk_precmd
    add-zsh-hook preexec _husk_preexec
  fi

  _husk_precmd
fi

# ---------------------------------------------------------------------------
# Husk GUI bridge command
# ---------------------------------------------------------------------------

# Emit an OSC 777 escape sequence so the Husk host can act on it.
_husk_emit() {
  printf '\e]777;husk;%s\e\\' "$1"
}

# Unified husk CLI for bridging terminal → GUI.
# Usage:
#   husk open <path>          — open file in editor (images/HTML → preview)
#   husk preview <path|url>   — open path or URL in preview pane
#   husk notify "message"     — send a desktop notification
#   husk diff <left> <right>  — open both files in editor
#   husk help                 — show this help
husk() {
  local cmd="${1:-help}"
  case "$cmd" in
    open)
      if [ -z "$2" ]; then echo "Usage: husk open <path>"; return 1; fi
      local p="${2#file://}"
      p="${p/#\~/$HOME}"
      _husk_emit "open;${p}"
      ;;
    preview)
      if [ -z "$2" ]; then echo "Usage: husk preview <path|url>"; return 1; fi
      local p="${2#file://}"
      p="${p/#\~/$HOME}"
      _husk_emit "preview;${p}"
      ;;
    notify)
      if [ -z "$2" ]; then echo "Usage: husk notify <message>"; return 1; fi
      _husk_emit "notify;${2}"
      ;;
    diff)
      if [ -z "$2" ] || [ -z "$3" ]; then echo "Usage: husk diff <left> <right>"; return 1; fi
      local l="${2#file://}"
      local r="${3#file://}"
      l="${l/#\~/$HOME}"
      r="${r/#\~/$HOME}"
      _husk_emit "diff;${l};${r}"
      ;;
    help|*)
      cat <<'EOF'
Husk — terminal ↔ GUI bridge commands

  husk open <path>         Open file in editor (images/HTML → preview pane)
  husk preview <path|url>  Open path or URL in preview pane
  husk notify "message"    Send a desktop notification via Husk
  husk diff <l> <r>        Open both files in the editor
  husk help                Show this help
EOF
      ;;
  esac
}
:
