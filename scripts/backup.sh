#!/bin/bash
# =============================================================================
# Interagent Backup Script
# Version: 1.0.0
# Description: Backup databases, keys, and configuration for Automaton + Nanobot
# =============================================================================

set -e

# Configuration
BACKUP_BASE_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BACKUP_BASE_DIR}/${TIMESTAMP}"

# Paths
AUTOMATON_HOME="${AUTOMATON_HOME:-$HOME/.automaton}"
NANOBOT_HOME="${NANOBOT_HOME:-$HOME/.nanobot}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# =============================================================================
# Backup Functions
# =============================================================================

backup_automaton_database() {
    log_info "Backing up Automaton database..."

    local db_path="${AUTOMATON_HOME}/interagent.db"

    if [[ -f "$db_path" ]]; then
        # Create backup directory
        mkdir -p "${BACKUP_DIR}/automaton"

        # Use SQLite backup command for consistency
        sqlite3 "$db_path" ".backup '${BACKUP_DIR}/automaton/interagent.db'"

        log_info "Automaton database backed up: ${BACKUP_DIR}/automaton/interagent.db"
    else
        log_warn "Automaton database not found at $db_path"
    fi
}

backup_automaton_keys() {
    log_info "Backing up Automaton keys..."

    local keys_dir="${AUTOMATON_HOME}/keys"

    if [[ -d "$keys_dir" ]]; then
        mkdir -p "${BACKUP_DIR}/automaton"

        # Create encrypted archive of keys
        if [[ -n "$BACKUP_PASSWORD" ]]; then
            tar -czf - -C "$AUTOMATON_HOME" keys | \
                openssl enc -aes-256-cbc -salt -pbkdf2 \
                    -pass env:BACKUP_PASSWORD \
                    -out "${BACKUP_DIR}/automaton/keys.tar.gz.enc"
            log_info "Automaton keys backed up (encrypted): ${BACKUP_DIR}/automaton/keys.tar.gz.enc"
        else
            log_warn "BACKUP_PASSWORD not set, skipping key encryption"
            tar -czf "${BACKUP_DIR}/automaton/keys.tar.gz" -C "$AUTOMATON_HOME" keys
            log_info "Automaton keys backed up (unencrypted): ${BACKUP_DIR}/automaton/keys.tar.gz"
        fi
    else
        log_warn "Automaton keys directory not found at $keys_dir"
    fi
}

backup_automaton_config() {
    log_info "Backing up Automaton configuration..."

    mkdir -p "${BACKUP_DIR}/automaton"

    # Backup config files
    for config_file in interagent.yml config.yml did.json; do
        if [[ -f "${AUTOMATON_HOME}/${config_file}" ]]; then
            cp "${AUTOMATON_HOME}/${config_file}" "${BACKUP_DIR}/automaton/"
            log_info "Backed up: ${config_file}"
        fi
    done
}

backup_nanobot_data() {
    log_info "Backing up Nanobot data..."

    local nanobot_data="${NANOBOT_HOME}"

    if [[ -d "$nanobot_data" ]]; then
        mkdir -p "${BACKUP_DIR}/nanobot"

        # Backup any SQLite databases
        find "$nanobot_data" -name "*.db" -type f -exec cp {} "${BACKUP_DIR}/nanobot/" \; 2>/dev/null || true

        # Backup config files
        for config_file in config.yml config.json interagent.yml; do
            if [[ -f "${nanobot_data}/${config_file}" ]]; then
                cp "${nanobot_data}/${config_file}" "${BACKUP_DIR}/nanobot/"
            fi
        done

        log_info "Nanobot data backed up: ${BACKUP_DIR}/nanobot"
    else
        log_warn "Nanobot data directory not found at $nanobot_data"
    fi
}

create_checksums() {
    log_info "Creating checksums..."

    cd "$BACKUP_DIR"
    find . -type f -exec sha256sum {} \; > checksums.sha256

    log_info "Checksums created: ${BACKUP_DIR}/checksums.sha256"
}

create_manifest() {
    log_info "Creating backup manifest..."

    cat > "${BACKUP_DIR}/manifest.json" << EOF
{
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "version": "1.0.0",
    "hostname": "$(hostname)",
    "components": {
        "automaton": {
            "database": $( [[ -f "${BACKUP_DIR}/automaton/interagent.db" ]] && echo "true" || echo "false" ),
            "keys": $( [[ -f "${BACKUP_DIR}/automaton/keys.tar.gz.enc" || -f "${BACKUP_DIR}/automaton/keys.tar.gz" ]] && echo "true" || echo "false" ),
            "config": $( ls ${BACKUP_DIR}/automaton/*.yml ${BACKUP_DIR}/automaton/*.json 2>/dev/null | wc -l | tr -d ' ' )
        },
        "nanobot": {
            "data": $( ls ${BACKUP_DIR}/nanobot/ 2>/dev/null | wc -l | tr -d ' ' )
        }
    }
}
EOF

    log_info "Manifest created: ${BACKUP_DIR}/manifest.json"
}

cleanup_old_backups() {
    log_info "Cleaning up old backups (retention: ${RETENTION_DAYS} days)..."

    find "$BACKUP_BASE_DIR" -type d -name "20*" -mtime +${RETENTION_DAYS} -exec rm -rf {} \; 2>/dev/null || true

    log_info "Old backups cleaned up"
}

# =============================================================================
# Main
# =============================================================================

main() {
    log_info "=========================================="
    log_info "Interagent Backup Script v1.0.0"
    log_info "=========================================="
    log_info "Backup directory: ${BACKUP_DIR}"
    log_info ""

    # Create backup directory
    mkdir -p "$BACKUP_DIR"

    # Run backups
    backup_automaton_database
    backup_automaton_keys
    backup_automaton_config
    backup_nanobot_data

    # Create verification files
    create_checksums
    create_manifest

    # Cleanup old backups
    cleanup_old_backups

    # Calculate backup size
    BACKUP_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)

    log_info ""
    log_info "=========================================="
    log_info "Backup completed successfully!"
    log_info "Location: ${BACKUP_DIR}"
    log_info "Size: ${BACKUP_SIZE}"
    log_info "=========================================="
}

# Run main function
main "$@"
