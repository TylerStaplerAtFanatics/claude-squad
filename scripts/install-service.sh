#!/bin/sh
#
# install-service.sh — Install stapler-squad as a system service
#
# Supports:
#   Linux  — systemd user service (~/.config/systemd/user/)
#   macOS  — LaunchAgent (~/Library/LaunchAgents/)
#
# Usage:
#   ./scripts/install-service.sh              # install
#   ./scripts/install-service.sh --uninstall  # remove
#
# Environment:
#   STAPLER_SQUAD_BIN   Override binary path (default: auto-detected)
#

set -e

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { printf "${BLUE}==>${NC} %s\n" "$1"; }
log_success() { printf "${GREEN}✓${NC} %s\n" "$1"; }
log_warning() { printf "${YELLOW}!${NC} %s\n" "$1"; }
log_error()   { printf "${RED}✗${NC} %s\n" "$1" >&2; }

# ── OS Detection ──────────────────────────────────────────────────────────────
detect_os() {
    case "$(uname -s)" in
        Linux*)  echo "linux" ;;
        Darwin*) echo "macos" ;;
        *)       echo "unsupported" ;;
    esac
}

# ── Binary Path Resolution ────────────────────────────────────────────────────
# Priority: STAPLER_SQUAD_BIN env var > which > local build artifact
resolve_binary() {
    if [ -n "${STAPLER_SQUAD_BIN:-}" ]; then
        if [ ! -x "$STAPLER_SQUAD_BIN" ]; then
            log_error "STAPLER_SQUAD_BIN='$STAPLER_SQUAD_BIN' is not executable"
            exit 1
        fi
        echo "$STAPLER_SQUAD_BIN"
        return
    fi

    if command -v stapler-squad >/dev/null 2>&1; then
        command -v stapler-squad
        return
    fi

    local_bin="$(pwd)/stapler-squad"
    if [ -x "$local_bin" ]; then
        echo "$local_bin"
        return
    fi

    log_error "Cannot find stapler-squad binary."
    log_info  "Options:"
    log_info  "  1. Run 'make build' then re-run this script from the project root"
    log_info  "  2. Run 'make install' to install to GOPATH/bin, then re-run"
    log_info  "  3. Set STAPLER_SQUAD_BIN=/path/to/binary and re-run"
    exit 1
}

# ── Linux / systemd user service ──────────────────────────────────────────────
install_linux() {
    bin_path="$1"
    service_dir="$HOME/.config/systemd/user"
    service_file="$service_dir/stapler-squad.service"
    log_dir="$HOME/.stapler-squad/logs"

    # Verify systemd --user is available before writing any files
    if ! systemctl --user is-system-running >/dev/null 2>&1 && \
       ! systemctl --user status >/dev/null 2>&1; then
        log_error "systemd user session is not available."
        log_info  "On WSL or minimal containers, try adding stapler-squad to ~/.profile instead:"
        log_info  "  echo '$bin_path &' >> ~/.profile"
        exit 1
    fi

    log_info "Creating systemd user service..."
    mkdir -p "$service_dir"
    mkdir -p "$log_dir"

    cat > "$service_file" << EOF
[Unit]
Description=Stapler Squad — AI Agent Session Manager
Documentation=https://github.com/tstapler/stapler-squad
After=network.target

[Service]
Type=simple
ExecStart=$bin_path
WorkingDirectory=$HOME
Restart=on-failure
RestartSec=5s
StandardOutput=append:$log_dir/service.log
StandardError=append:$log_dir/service.log
Environment=HOME=$HOME
Environment=PATH=$PATH

[Install]
WantedBy=default.target
EOF

    log_success "Service file written to: $service_file"
    echo ""
    log_info "Enable and start now:"
    echo "    systemctl --user daemon-reload"
    echo "    systemctl --user enable --now stapler-squad"
    echo ""
    log_info "Check status:"
    echo "    systemctl --user status stapler-squad"
    echo ""
    log_info "View logs:"
    echo "    tail -f $log_dir/service.log"
    echo ""
    log_info "Optional — keep service running after logout (one-time setup):"
    echo "    loginctl enable-linger \$USER"
    echo ""
    log_warning "If you rebuild or move the binary, re-run this script to update the service file."
}

# ── macOS / LaunchAgent ───────────────────────────────────────────────────────
install_macos() {
    bin_path="$1"
    plist_dir="$HOME/Library/LaunchAgents"
    plist_file="$plist_dir/com.stapler-squad.plist"
    log_dir="$HOME/.stapler-squad/logs"

    log_info "Creating macOS LaunchAgent..."
    mkdir -p "$plist_dir"
    mkdir -p "$log_dir"

    cat > "$plist_file" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
    "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.stapler-squad</string>

    <key>ProgramArguments</key>
    <array>
        <string>$bin_path</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <key>WorkingDirectory</key>
    <string>$HOME</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>$HOME</string>
        <key>PATH</key>
        <string>$PATH</string>
    </dict>

    <key>StandardOutPath</key>
    <string>$log_dir/service.log</string>

    <key>StandardErrorPath</key>
    <string>$log_dir/service.log</string>

    <key>ThrottleInterval</key>
    <integer>5</integer>
</dict>
</plist>
EOF

    log_success "LaunchAgent plist written to: $plist_file"
    echo ""
    log_info "Load and start now (macOS 12 and earlier):"
    echo "    launchctl load -w $plist_file"
    echo ""
    log_info "Load and start now (macOS 13 Ventura and later):"
    echo "    launchctl bootstrap gui/\$(id -u) $plist_file"
    echo ""
    log_info "Check status:"
    echo "    launchctl list | grep stapler-squad"
    echo ""
    log_info "View logs:"
    echo "    tail -f $log_dir/service.log"
    echo ""
    log_warning "If you rebuild or move the binary, re-run this script to update the plist."
}

# ── Uninstall ─────────────────────────────────────────────────────────────────
uninstall_service() {
    os="$1"
    case "$os" in
        linux)
            service_file="$HOME/.config/systemd/user/stapler-squad.service"
            log_info "Stopping and disabling systemd user service..."
            systemctl --user stop stapler-squad 2>/dev/null || true
            systemctl --user disable stapler-squad 2>/dev/null || true
            if [ -f "$service_file" ]; then
                rm -f "$service_file"
                systemctl --user daemon-reload 2>/dev/null || true
                log_success "Removed: $service_file"
            else
                log_warning "Service file not found (already removed?): $service_file"
            fi
            ;;
        macos)
            plist_file="$HOME/Library/LaunchAgents/com.stapler-squad.plist"
            log_info "Unloading macOS LaunchAgent..."
            launchctl unload "$plist_file" 2>/dev/null || true
            if [ -f "$plist_file" ]; then
                rm -f "$plist_file"
                log_success "Removed: $plist_file"
            else
                log_warning "Plist not found (already removed?): $plist_file"
            fi
            ;;
    esac
    log_info "stapler-squad will no longer start automatically on login."
    log_info "Your data in ~/.stapler-squad/ has not been touched."
}

# ── Main ──────────────────────────────────────────────────────────────────────
UNINSTALL=0
for arg in "$@"; do
    case "$arg" in
        --uninstall) UNINSTALL=1 ;;
    esac
done

main() {
    os=$(detect_os)

    if [ "$os" = "unsupported" ]; then
        log_error "Unsupported platform: $(uname -s)"
        log_info  "Supported platforms: Linux (systemd user), macOS (LaunchAgent)"
        exit 1
    fi

    if [ "$UNINSTALL" = "1" ]; then
        uninstall_service "$os"
        exit 0
    fi

    bin_path=$(resolve_binary)
    log_info "Using binary: $bin_path"

    case "$os" in
        linux) install_linux "$bin_path" ;;
        macos) install_macos "$bin_path" ;;
    esac
}

main "$@"
