# husk-shell-integration (bashrc)
#
# Differences vs zsh integration:
# - We emulate login-shell init manually (/etc/profile, profile files) because
#   bash ignores --rcfile when started with -l.
# - Pre-exec marker uses PS0 (bash 4.4+). On older bash (macOS default 3.2) we
#   skip it — a fragile DEBUG-trap alternative would clobber the user's own
#   traps and interact badly with debuggers.

if [ -z "$__HUSK_HOOKS_LOADED" ]; then
  __HUSK_HOOKS_LOADED=1

  [ -f /etc/profile ] && source /etc/profile
  [ -f /etc/bashrc ] && source /etc/bashrc
  if [ -f "$HOME/.bash_profile" ]; then
    source "$HOME/.bash_profile"
  elif [ -f "$HOME/.bash_login" ]; then
    source "$HOME/.bash_login"
  elif [ -f "$HOME/.profile" ]; then
    source "$HOME/.profile"
  fi
  # .bashrc may have been sourced already by .bash_profile; sourcing again is
  # safe for idempotent rc files (the common case). If yours has side effects
  # on reload, guard with a flag.
  [ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"

  # Colorful defaults for common commands
  export CLICOLOR=1
  export LS_COLORS='di=34:ln=36:so=35:pi=33:ex=32:bd=34;46:cd=34;43:su=30;41:sg=30;46:tw=30;42:ow=30;43'
  export GCC_COLORS='error=01;31:warning=01;35:note=01;36:caret=01;32:locus=01:quote=01'
  alias grep='grep --color=auto' 2>/dev/null
  alias diff='diff --color=auto' 2>/dev/null
  alias ip='ip -color=auto' 2>/dev/null

  # Enable colors in less/man pages
  export LESS='-R --mouse'
  export LESS_TERMCAP_mb=$'\e[1;31m'
  export LESS_TERMCAP_md=$'\e[1;36m'
  export LESS_TERMCAP_me=$'\e[0m'
  export LESS_TERMCAP_so=$'\e[1;44;33m'
  export LESS_TERMCAP_se=$'\e[0m'
  export LESS_TERMCAP_us=$'\e[1;32m'
  export LESS_TERMCAP_ue=$'\e[0m'

  # Colorful grep highlight
  export GREP_COLORS='mt=1;31;48:fn=35:ln=32:se=36'

  # Git colors
  command git config --global color.ui auto 2>/dev/null
  command git config --global color.diff auto 2>/dev/null
  command git config --global color.status auto 2>/dev/null
  command git config --global color.branch auto 2>/dev/null
  command git config --global color.interactive auto 2>/dev/null
  command git config --global color.grep auto 2>/dev/null
  command git config --global color.pager true 2>/dev/null

  # Use bat as man pager if available
  if command -v bat >/dev/null 2>&1; then
    export MANPAGER="sh -c 'col -bx | bat -l man -p'"
  fi

  # Use delta for git diff if available
  if command -v delta >/dev/null 2>&1; then
    command git config --global core.pager delta 2>/dev/null
    command git config --global delta.side-by-side false 2>/dev/null
    command git config --global delta.line-numbers true 2>/dev/null
  fi

  # Minimal colored prompt fallback if user has no framework.
  # Shows: cwd $  with green/red $ based on exit code.
  if [ -z "$PS1" ] || [ "$PS1" = '\\s-\\v\\$ ' ] || [ "$PS1" = '\\u@\\h:\\w\\$ ' ] || [ "$PS1" = '$ ' ]; then
    _husk_prompt() {
      local ret=$?
      local git_branch=''
      if command -v git >/dev/null 2>&1; then
        git_branch=$(git symbolic-ref --short HEAD 2>/dev/null || git describe --tags --exact-match 2>/dev/null || git rev-parse --short HEAD 2>/dev/null)
        [ -n "$git_branch" ] && git_branch="\[\e[33m\](${git_branch})\[\e[0m\] "
      fi
      local color='$([ "$ret" -eq 0 ] && echo "\[\e[32m\]" || echo "\[\e[31m\]")'
      PS1="\[\e[36m\]\w\[\e[0m\] ${git_branch}${color}\$\[\e[0m\] "
    }
    PROMPT_COMMAND="_husk_prompt${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
  fi

  _husk_urlencode() {
    local LC_ALL=C s="$1" i c
    for (( i=0; i<${#s}; i++ )); do
      c="${s:i:1}"
      case "$c" in
        [a-zA-Z0-9/._~-]) printf '%s' "$c" ;;
        *) printf '%%%02X' "'$c" ;;
      esac
    done
  }

  _husk_precmd() {
    local _husk_ret=$?
    printf '\e]133;D;%s\e\\' "$_husk_ret"
    printf '\e]7;file://%s%s\e\\' "${HOSTNAME:-$(uname -n 2>/dev/null)}" "$(_husk_urlencode "$PWD")"
    if [ -z "$__HUSK_PS1_INJECTED" ]; then
      PS1='\[\e]133;B\e\\\]'"$PS1"
      __HUSK_PS1_INJECTED=1
    fi
    printf '\e]133;A\e\\'
  }

  # Capture command text for terminal vitals (bash 4.4+ via PS0)
  __husk_last_cmd=""
  __husk_skip_debug=0
  __husk_debug_trap() {
    if [ "$__husk_skip_debug" -eq 1 ]; then
      __husk_skip_debug=0
      return
    fi
    # Skip if this is a shell builtin / function / prompt command
    case "$BASH_COMMAND" in
      _husk_precmd*|__husk_*|"["*|"printf "*|*"\e]"*) return ;;
    esac
    __husk_last_cmd="$BASH_COMMAND"
  }
  __husk_ps0() {
    if [ -n "$__husk_last_cmd" ]; then
      printf '\e]778;husk;cmd;%s\e\\' "$__husk_last_cmd"
      __husk_last_cmd=""
    fi
    printf '\e]133;C\e\\'
    __husk_skip_debug=1
  }

  case ":${PROMPT_COMMAND:-}:" in
    *":_husk_precmd:"*) ;;
    *) PROMPT_COMMAND="_husk_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;
  esac

  # Pre-exec marker + command capture via PS0 (bash 4.4+).
  if [ "${BASH_VERSINFO[0]:-0}" -gt 4 ] \
     || { [ "${BASH_VERSINFO[0]:-0}" -eq 4 ] && [ "${BASH_VERSINFO[1]:-0}" -ge 4 ]; }; then
    PS0='$(__husk_ps0)'"${PS0:-}"
    trap '__husk_debug_trap' DEBUG
  fi

  _husk_precmd
fi

# Fuzzy file finder (Ctrl+T) and cd navigator (Alt+C) via fzf.
# Ctrl+R is handled by Husk's GUI history panel — shell fzf for history
# is disabled to avoid a glitchy TUI inside xterm.js.
if command -v fzf >/dev/null 2>&1 && [ -f "${BASH_SOURCE[0]:-}" ]; then
  _husk_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [ -f "$_husk_script_dir/fzf-key-bindings.bash" ]; then
    # Disable fzf's Ctrl+R so Husk's GUI panel takes over exclusively
    FZF_CTRL_R_COMMAND=""
    source "$_husk_script_dir/fzf-key-bindings.bash"
  fi
  unset _husk_script_dir
fi

# Defensive: if the user's ~/.bashrc (sourced above) re-bound Ctrl+R to fzf,
# strip it here so Husk's GUI panel always wins.
if type -t fzf-history-widget &>/dev/null; then
  bind -r '\C-r' 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# Husk GUI bridge command (bash)
# ---------------------------------------------------------------------------

_husk_emit() {
  printf '\e]777;husk;%s\e\\' "$1"
}

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
    cp)
      if [ -z "$2" ] || [ -z "$3" ]; then echo "Usage: husk cp <source> <dest>"; return 1; fi
      local src="${2#file://}"
      local dst="${3#file://}"
      src="${src/#\~/$HOME}"
      dst="${dst/#\~/$HOME}"
      # Determine direction: if source exists locally, it's a push; else pull
      if [ -e "$src" ]; then
        _husk_emit "cp;push;${src};${dst}"
      else
        _husk_emit "cp;pull;${src};${dst}"
      fi
      ;;
    help|*)
      cat <<'EOF'
Husk — terminal ↔ GUI bridge commands (LOCAL ONLY)

These commands work in terminals spawned by Husk. They do NOT work on
remote hosts accessed via SSH unless you add the husk function to the
remote shell's rc file (e.g. ~/.bashrc). For remote file transfers,
use scp/rsync or Husk's SFTP panel instead.

  husk open <path>         Open file in editor (images/HTML → preview pane)
  husk preview <path|url>  Open path or URL in preview pane
  husk notify "message"    Send a desktop notification via Husk
  husk diff <l> <r>        Open both files in the editor
  husk cp <src> <dst>      Copy file via terminal bridge (auto direction)
                           Works: local shells, docker exec, serial consoles
                           Doesn't work: SSH hosts (unless husk is installed)
  husk help                Show this help
EOF
      ;;
  esac
}
:
