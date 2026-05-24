# husk-shell-integration (zprofile)
#
# See zshenv.zsh for the rationale on the trailing `:`.
{
  _husk_user_zdotdir="${HUSK_USER_ZDOTDIR:-$HOME}"
  [ -f "$_husk_user_zdotdir/.zprofile" ] && source "$_husk_user_zdotdir/.zprofile"
  unset _husk_user_zdotdir
}
:
