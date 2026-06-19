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
            echo "Husk — terminal ↔ GUI bridge commands"
            echo ""
            echo "  husk open <path>         Open file in editor (images/HTML → preview pane)"
            echo "  husk preview <path|url>  Open path or URL in preview pane"
            echo "  husk notify \"message\"    Send a desktop notification via Husk"
            echo "  husk diff <l> <r>        Open both files in the editor"
            echo "  husk cp <src> <dst>      Copy file between remote and local (auto direction)"
            echo "  husk help                Show this help"
    end
end
