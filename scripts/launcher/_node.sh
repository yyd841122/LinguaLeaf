# Resolves a usable node binary (>= 22.12, required for
# --env-file-if-exists and the project engines) into NODE_BIN without
# relying on the PATH a non-interactive `wsl.exe -- <cmd>` provides. That
# PATH often carries the distro's apt node (Ubuntu 24.04 ships 18.x — too
# old), so every candidate is version-checked; nvm installs are considered
# even when their PATH wiring never loaded. Sourced by launch.sh/stop.sh;
# on failure _NODE_SEEN holds "path (version)" lines for diagnostics.
NODE_BIN=""

_node_major_minor() {
  _v=$("$1" -v 2>/dev/null) || return 1
  case $_v in
    v[0-9]*.[0-9]*.[0-9]*) ;;
    *) return 1 ;;
  esac
  _mm=${_v#v}
  echo "${_mm%.*}"
}

_node_version_ok() {
  _mm=$(_node_major_minor "$1") || return 1
  _maj=${_mm%%.*}
  _min=${_mm#*.}
  [ "$_maj" -gt 22 ] && return 0
  [ "$_maj" -eq 22 ] && [ "$_min" -ge 12 ] && return 0
  return 1
}

_node_add_candidate() {
  [ -x "$1" ] || return 0
  case ":${_NODE_CANDIDATES}:" in
    *":$1:"*) ;;
    *) _NODE_CANDIDATES="${_NODE_CANDIDATES:+$_NODE_CANDIDATES }$1" ;;
  esac
}

_node_resolve() {
  NODE_BIN=""
  _NODE_CANDIDATES=""
  _NODE_SEEN=""
  _node_add_candidate "$(command -v node 2>/dev/null)"
  if [ -f "$HOME/.nvm/nvm.sh" ]; then
    # Login profiles are not loaded non-interactively; source nvm explicitly.
    # shellcheck disable=SC1091
    . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
    _node_add_candidate "$(command -v node 2>/dev/null)"
    for _glob in $(ls -1 "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -rV); do
      _node_add_candidate "$_glob"
    done
  fi
  for _cand in $_NODE_CANDIDATES; do
    if _node_version_ok "$_cand"; then
      NODE_BIN=$_cand
      return 0
    fi
    _NODE_SEEN="${_NODE_SEEN}  $_cand ($("$_cand" -v 2>/dev/null || echo '?'))
"
  done
  return 1
}
