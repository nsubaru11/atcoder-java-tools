#!/usr/bin/env bash

set -euo pipefail

readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly CYAN='\033[0;36m'
readonly NC='\033[0m'

source_optional() {
	local target_file="$1"
	if [[ -f "$target_file" ]]; then
		set +u
		# shellcheck disable=SC1090,SC1091
		source "$target_file" >/dev/null 2>&1
		set -u
	fi
}

require_command() {
	local cmd="$1"
	local error_msg="$2"
	if ! command -v "$cmd" >/dev/null 2>&1; then
		echo -e "${RED}[ERROR] '$cmd' was not found in WSL. ${error_msg}${NC}" >&2
		exit 1
	fi
}

source_optional "$HOME/.profile"
source_optional "$HOME/.bashrc"

if [[ -d "$HOME/.bun/bin" ]]; then
	export PATH="$HOME/.bun/bin:$PATH"
fi

source_optional "$HOME/.sdkman/bin/sdkman-init.sh"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SERVER_PATH="$SCRIPT_DIR/../src/daemon/server.ts"

JAVA_VER="${1:-24}"

JAVA_HOME_VAR="JAVA_HOME_${JAVA_VER}"
JAVA_PATH="${!JAVA_HOME_VAR:-${JAVA_HOME:-}}"

is_windows_path() {
	[[ "$1" =~ ^[A-Za-z]:\\ ]]
}

if [[ -n "$JAVA_PATH" ]] && is_windows_path "$JAVA_PATH"; then
	echo -e "${YELLOW}[INFO] Ignoring Windows-style JAVA_HOME in WSL: $JAVA_PATH${NC}" >&2
	unset JAVA_HOME
	JAVA_PATH=""
fi

if [[ -n "$JAVA_PATH" ]]; then
	export JAVA_HOME="$JAVA_PATH"
	export PATH="$JAVA_HOME/bin:$PATH"
fi

require_command "bun" "Install Bun inside WSL first."
require_command "java" "Install a Linux JDK or set $JAVA_HOME_VAR / JAVA_HOME inside WSL."
require_command "javac" "Install a Linux JDK or set $JAVA_HOME_VAR / JAVA_HOME inside WSL."

export LOCAL_RUNNER_BASE_DIR="${LOCAL_RUNNER_BASE_DIR:-/dev/shm/atcoder-local-runner}"
LOG_FILE_PATH="$LOCAL_RUNNER_BASE_DIR/local-runner.log"

RUNNER_INFO="$(command -v bun)"

mkdir -p "$LOCAL_RUNNER_BASE_DIR"

echo -e "========================================"
echo -e "  Local Runner Server (WSL / Java ${JAVA_VER})"
echo -e "========================================"
echo -e "SCRIPT_DIR: $SCRIPT_DIR"
echo -e "SERVER_PATH: $SERVER_PATH"
echo -e "JAVA_HOME : ${JAVA_HOME:-<PATH lookup>}"
echo -e "BASE_DIR  : $LOCAL_RUNNER_BASE_DIR"
echo -e "LOG_FILE  : $LOG_FILE_PATH"
echo -e "RUNNER    : $RUNNER_INFO"
echo -e "JAVA      : $(command -v java)"
echo -e "JAVAC     : $(command -v javac)"
echo -e "========================================"

java -version
echo -e "${GREEN}Starting WSL local runner server...${NC}"

shift 2>/dev/null || true # Consume $1 (JavaVer), ignore if no args

# serve は新しいコンソール窓(ConPTY)に直結して起動するため stdout は tty。
# ログはバッファされずリアルタイムに流れるので、特別なラッパーは不要。
exec bun "$SERVER_PATH" "$@"