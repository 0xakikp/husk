# husk-shell-integration (fish)
# Emits OSC 7 (cwd) + OSC 133 A/B/C/D so the host tracks cwd and prompt
# boundaries without re-parsing the prompt.

if set -q __HUSK_HOOKS_LOADED
    exit 0
end
set -g __HUSK_HOOKS_LOADED 1

set -g __HUSK_HOST (uname -n 2>/dev/null; or echo localhost)

# URL-encode a path keeping `/` intact so it stays valid inside file://.
function __husk_urlencode_path
    set -l parts (string split '/' -- $argv[1])
    set -l out
    for p in $parts
        if test -n "$p"
            set out $out (string escape --style=url -- $p)
        else
            set out $out ""
        end
    end
    string join '/' $out
end

function __husk_restore_status
    return $argv[1]
end

# Only this exported variable is queried. Quoting preserves fish's exported
# value joining (including path variables). No environment or file reads.
function __husk_report_kubeconfig
    if test -n "$SSH_CONNECTION$SSH_CLIENT$SSH_TTY"
        printf '\e]779;husk;kubeconfig;1;unavailable\e\\'
        return
    end
    if not set -q -x KUBECONFIG; or test -z "$KUBECONFIG"
        if set -q -x HOME; and string match -q '/*' -- "$HOME"; and test (string length -- "$HOME") -le 8178
            set -l __husk_default "$HOME/.kube/config"
            printf '\e]779;husk;kubeconfig;1;unset;%s\e\\' (string escape --style=url -- "$__husk_default")
        else
            printf '\e]779;husk;kubeconfig;1;unavailable\e\\'
        end
        return
    end
    if test (string length -- "$KUBECONFIG") -gt 8192
        printf '\e]779;husk;kubeconfig;1;unavailable\e\\'
        return
    end
    printf '\e]779;husk;kubeconfig;1;value;%s\e\\' (string escape --style=url -- "$KUBECONFIG")
end

# Only selected exported paths/names; Docker host is a boolean, never its URL.
function __husk_report_context
    set -l __husk_previous $status
    if test -n "$SSH_CONNECTION$SSH_CLIENT$SSH_TTY"
        printf '\e]781;husk;context;1;unavailable\e\\'
        return $__husk_previous
    end
    # The user prompt may have changed cwd since the first OSC7.
    printf '\e]7;file://%s%s\e\\' "$__HUSK_HOST" (__husk_urlencode_path "$PWD")
    set -l __husk_home ''
    set -l __husk_kube ''
    set -l __husk_default ''
    set -l __husk_docker ''
    set -l __husk_context ''
    set -l __husk_host 0
    if set -q -x HOME; and string match -q '/*' -- "$HOME"
        set __husk_home "$HOME"
    end
    if set -q -x KUBECONFIG
        set __husk_kube "$KUBECONFIG"
    end
    if test -z "$__husk_kube"; and test -n "$__husk_home"
        set -l __husk_base (string replace -r '/$' '' -- "$__husk_home")
        set __husk_default "$__husk_base/.kube/config"
    end
    if set -q -x DOCKER_CONFIG
        set __husk_docker "$DOCKER_CONFIG"
    end
    if test -z "$__husk_docker"; and test -n "$__husk_home"
        set -l __husk_base (string replace -r '/$' '' -- "$__husk_home")
        set __husk_docker "$__husk_base/.docker"
    end
    if set -q -x DOCKER_CONTEXT
        set __husk_context "$DOCKER_CONTEXT"
    end
    if set -q -x DOCKER_HOST; and test -n "$DOCKER_HOST"
        set __husk_host 1
    end
    # Bound work before encoding, then enforce UTF-8 byte limits without a CLI.
    if test (string length -- "$__husk_kube") -gt 8192; or test (string length -- "$__husk_default") -gt 8192; or test (string length -- "$__husk_docker") -gt 8192; or test (string length -- "$__husk_context") -gt 1024
        printf '\e]781;husk;context;1;unavailable\e\\'
    else
        set -l __husk_encoded
        set -l __husk_index 0
        set -l __husk_total 5
        for __husk_value in "$__husk_kube" "$__husk_default" "$__husk_docker" "$__husk_context"
            set __husk_index (math $__husk_index + 1)
            set -l __husk_part (string escape --style=url -- "$__husk_value")
            # Keep empty fields as one argument instead of an empty substitution.
            set -l __husk_byte_markers (string replace -ar '%[0-9A-Fa-f]{2}' 'x' -- "$__husk_part")
            set -l __husk_bytes (string length -- "$__husk_byte_markers")
            set -l __husk_max 8192
            if test $__husk_index -eq 4
                set __husk_max 1024
            end
            set __husk_total (math $__husk_total + $__husk_bytes)
            if test $__husk_bytes -gt $__husk_max; or test $__husk_total -gt 24576
                printf '\e]781;husk;context;1;unavailable\e\\'
                return $__husk_previous
            end
            set -a __husk_encoded "$__husk_part"
        end
        printf '\e]781;husk;context;1;%s;%s;%s;%s;%s\e\\' "$__husk_encoded[1]" "$__husk_encoded[2]" "$__husk_encoded[3]" "$__husk_encoded[4]" "$__husk_host"
    end
    return $__husk_previous
end

if functions -q fish_prompt
    functions -c fish_prompt __husk_user_prompt
end

function fish_prompt
    set -l __husk_status $status
    printf '\e]133;D;%d\e\\' $__husk_status
    printf '\e]7;file://%s%s\e\\' "$__HUSK_HOST" (__husk_urlencode_path "$PWD")
    printf '\e]133;A\e\\'
    __husk_restore_status $__husk_status
    if functions -q __husk_user_prompt
        __husk_user_prompt
    else
        printf '%s > ' (prompt_pwd)
    end
    # User prompt hooks may change exports; capture only once they are done.
    __husk_report_kubeconfig
    __husk_report_context
    printf '\e]133;B\e\\'
end

function __husk_preexec --on-event fish_preexec
    set -l cmd "$argv[1]"
    if test -n "$cmd"
        printf '\e]778;husk;cmd;%s\e\\' "$cmd"
    end
    printf '\e]133;C\e\\'
end

# ---------------------------------------------------------------------------
# Husk GUI bridge command (fish)
# ---------------------------------------------------------------------------

function _husk_emit
    printf '\e]777;husk;%s\e\\' "$argv[1]"
end

function husk
    set -l cmd "$argv[1]"
    if test -z "$cmd"
        set cmd "help"
    end
    switch "$cmd"
        case "open"
            if test -z "$argv[2]"
                echo "Usage: husk open <path>"
                return 1
            end
            set -l p (string replace "file://" "" "$argv[2]")
            set -l p (string replace -r "^~" "$HOME" "$p")
            _husk_emit "open;$p"
        case "preview"
            if test -z "$argv[2]"
                echo "Usage: husk preview <path|url>"
                return 1
            end
            set -l p (string replace "file://" "" "$argv[2]")
            set -l p (string replace -r "^~" "$HOME" "$p")
            _husk_emit "preview;$p"
        case "notify"
            if test -z "$argv[2]"
                echo "Usage: husk notify <message>"
                return 1
            end
            _husk_emit "notify;$argv[2]"
        case "diff"
            if test -z "$argv[2]"; or test -z "$argv[3]"
                echo "Usage: husk diff <left> <right>"
                return 1
            end
            set -l l (string replace "file://" "" "$argv[2]")
            set -l r (string replace "file://" "" "$argv[3]")
            set -l l (string replace -r "^~" "$HOME" "$l")
            set -l r (string replace -r "^~" "$HOME" "$r")
            _husk_emit "diff;$l;$r"
        case "cp"
            if test -z "$argv[2]"; or test -z "$argv[3]"
                echo "Usage: husk cp <source> <dest>"
                return 1
            end
            set -l src (string replace "file://" "" "$argv[2]")
            set -l dst (string replace "file://" "" "$argv[3]")
            set -l src (string replace -r "^~" "$HOME" "$src")
            set -l dst (string replace -r "^~" "$HOME" "$dst")
            if test -e "$src"
                _husk_emit "cp;push;$src;$dst"
            else
                _husk_emit "cp;pull;$src;$dst"
            end
        case "help" "*"
            echo "Husk — terminal ↔ GUI bridge commands (LOCAL ONLY)"
            echo ""
            echo "These commands work in terminals spawned by Husk. They do NOT work on"
            echo "remote hosts accessed via SSH unless you add the husk function to the"
            echo "remote shell's rc file (e.g. ~/.bashrc). For remote file transfers,"
            echo "use scp/rsync or Husk's SFTP panel instead."
            echo ""
            echo "  husk open <path>         Open file in editor (images/HTML → preview pane)"
            echo "  husk preview <path|url>  Open path or URL in preview pane"
            echo "  husk notify \"message\"    Send a desktop notification via Husk"
            echo "  husk diff <l> <r>        Open both files in the editor"
            echo "  husk cp <src> <dst>      Copy file via terminal bridge (auto direction)"
            echo "                           Works: local shells, docker exec, serial consoles"
            echo "                           Doesn't work: SSH hosts (unless husk is installed)"
            echo "  husk help                Show this help"
    end
end
