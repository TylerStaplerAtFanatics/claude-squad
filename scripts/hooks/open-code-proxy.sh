#!/usr/bin/env bash
#
# open-code-proxy.sh - Proxy for open-code with Stapler Squad permissions
#
# This script intercepts calls to open-code and routes them through 
# ssq-hooks proxy to ensure proper permission checks.
#

set -euo pipefail

# Pass all arguments to ssq-hooks proxy
# ssq-hooks proxy is expected to output a command to be executed.
CMD=$(ssq-hooks proxy -- open-code "$@")

# Execute the resulting command
eval "$CMD"
