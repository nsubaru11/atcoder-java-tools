#!/usr/bin/env bash
set -euo pipefail

source_optional() {
	local target_file="$1"
	if [[ -f "$target_file" ]]; then
		set +u
		# shellcheck disable=SC1090,SC1091
		source "$target_file" >/dev/null 2>&1
		set -u
	fi
}

source_optional "$HOME/.profile"
source_optional "$HOME/.bashrc"
source_optional "$HOME/.sdkman/bin/sdkman-init.sh"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SERVER_PATH="$SCRIPT_DIR/../runner/local-runner-server.js"
JAVA_VER="${1:-24}"
JAVA_HOME_VAR="JAVA_HOME_${JAVA_VER}"
JAVA_PATH="${!JAVA_HOME_VAR:-${JAVA_HOME:-}}"

is_windows_path() {
	[[ "$1" =~ ^[A-Za-z]:\\ ]]
}

if [[ -n "$JAVA_PATH" ]] && is_windows_path "$JAVA_PATH"; then
	echo "[INFO] Ignoring Windows-style JAVA_HOME in WSL: $JAVA_PATH" >&2
	unset JAVA_HOME
	JAVA_PATH=""
fi

if [[ -n "$JAVA_PATH" ]]; then
	export JAVA_HOME="$JAVA_PATH"
	export PATH="$JAVA_HOME/bin:$PATH"
fi

if ! command -v node >/dev/null 2>&1; then
	echo "[ERROR] 'node' was not found in WSL. Install Node.js inside WSL first." >&2
	exit 1
fi

if ! command -v java >/dev/null 2>&1; then
	echo "[ERROR] 'java' was not found in WSL. Install a Linux JDK or set $JAVA_HOME_VAR / JAVA_HOME inside WSL." >&2
	exit 1
fi

if ! command -v javac >/dev/null 2>&1; then
	echo "[ERROR] 'javac' was not found in WSL. Install a Linux JDK or set $JAVA_HOME_VAR / JAVA_HOME inside WSL." >&2
	exit 1
fi

export LOCAL_RUNNER_BASE_DIR="${LOCAL_RUNNER_BASE_DIR:-/dev/shm/atcoder-local-runner}"

LOG_FILE_PATH="$LOCAL_RUNNER_BASE_DIR/local-runner.log"

mkdir -p "$LOCAL_RUNNER_BASE_DIR"

cat <<EOF
========================================
  Local Runner Server (WSL / Java ${JAVA_VER})
========================================
SCRIPT_DIR: $SCRIPT_DIR
SERVER_PATH: $SERVER_PATH
JAVA_HOME : ${JAVA_HOME:-<PATH lookup>}
BASE_DIR  : $LOCAL_RUNNER_BASE_DIR
LOG_FILE  : $LOG_FILE_PATH
NODE      : $(command -v node)
JAVA      : $(command -v java)
JAVAC     : $(command -v javac)
========================================
EOF

java -version

echo "Starting WSL local runner server..."
exec node "$SERVER_PATH"
