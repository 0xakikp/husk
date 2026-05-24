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
    printf '\e]133;C\e\\'
end
