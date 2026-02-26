#!/bin/bash
# =============================================================================
# Interagent Restore Script
# Version: 1.0.0
# Description: Restore databases, keys, and configuration for Automaton + Nanobot
# =============================================================================

set -e

# Configuration
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
# Restore Functions
# =============================================================================

verify_backup() {
    local backup_dir="$1"

    log_info "Verifying backup integrity..."

    if [[ ! -d "$backup_dir" ]]; then
        log_error "Backup directory not found: $backup_dir"
        exit 1
    fi

    if [[ ! -f "${backup_dir}/checksums.sha256" ]]; then
        log_warn "No checksums file found, skipping verification"
        return 0
    fi

    cd "$backup_dir"

    if sha256sum -c checksums.sha256 --status 2>/dev/null; then
        log_info "Backup integrity verified successfully"
        return 0
    else
        log_error "Backup integrity check failed!"
        log_error "Some files may be corrupted"
        read -p "Continue anyway? (y/N): " confirm
        if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
            exit 1
        fi
    fi
}

show_manifest() {
    local backup_dir="$1"

    if [[ -f "${backup_dir}/manifest.json" ]]; then
        log_info "Backup manifest:"
        cat "${backup_dir}/manifest.json" | python3 -m json.tool 2>/dev/null || cat "${backup_dir}/manifest.json"
        echo ""
    fi
}

restore_automaton_database() {
    local backup_dir="$1"

    log_info "Restoring Automaton database..."

    local db_backup="${backup_dir}/automaton/interagent.db"

    if [[ -f "$db_backup" ]]; then
        # Create automaton directory if needed
        mkdir -p "${AUTOMATON_HOME}"

        # Backup current database if exists
        if [[ -f "${AUTOMATON_HOME}/interagent.db" ]]; then
            cp "${AUTOMATON_HOME}/interagent.db" "${AUTOMATON_HOME}/interagent.db.pre-restore.$(date +%s)"
            log_info "Current database backed up"
        fi

        # Restore database
        cp "$db_backup" "${AUTOMATON_HOME}/interagent.db"
        chmod 600 "${AUTOMATON_HOME}/interagent.db"

        log_info "Automaton database restored"
    else
        log_warn "No Automaton database backup found"
    fi
}

restore_automaton_keys() {
    local backup_dir="$1"

    log_info "Restoring Automaton keys..."

    local encrypted_keys="${backup_dir}/automaton/keys.tar.gz.enc"
    local plain_keys="${backup_dir}/automaton/keys.tar.gz"

    if [[ -f "$encrypted_keys" ]]; then
        if [[ -z "$BACKUP_PASSWORD" ]]; then
            log_error "BACKUP_PASSWORD required for encrypted keys"
            exit 1
        fi

        # Decrypt and extract
        openssl enc -aes-256-cbc -d -pbkdf2 \
            -pass env:BACKUP_PASSWORD \
            -in "$encrypted_keys" | \
            tar -xzf - -C "$AUTOMATON_HOME"

        chmod 700 "${AUTOMATON_HOME}/keys"
        find "${AUTOMATON_HOME}/keys" -type f -exec chmod 600 {} \;

        log_info "Automaton keys restored (from encrypted backup)"
    elif [[ -f "$plain_keys" ]]; then
        tar -xzf "$plain_keys" -C "$AUTOMATON_HOME"
        chmod 700 "${AUTOMATON_HOME}/keys"
        find "${AUTOMATON_HOME}/keys" -type f -exec chmod 600 {} \;

        log_info "Automaton keys restored"
    else
        log_warn "No Automaton keys backup found"
    fi
}

restore_automaton_config() {
    local backup_dir="$1"

    log_info "Restoring Automaton configuration..."

    local config_backup="${backup_dir}/automaton"

    if [[ -d "$config_backup" ]]; then
        mkdir -p "${AUTOMATON_HOME}"

        for config_file in interagent.yml config.yml did.json; do
            if [[ -f "${config_backup}/${config_file}" ]]; then
                cp "${config_backup}/${config_file}" "${AUTOMATON_HOME}/"
                log_info "Restored: ${config_file}"
            fi
        done
    else
        log_warn "No Automaton config backup found"
    fi
}

restore_nanobot_data() {
    local backup_dir="$1"

    log_info "Restoring Nanobot data..."

    local nanobot_backup="${backup_dir}/nanobot"

    if [[ -d "$nanobot_backup" ]]; then
        mkdir -p "${NANOBOT_HOME}"

        # Restore databases
        for db_file in "${nanobot_backup}"/*.db; do
            if [[ -f "$db_file" ]]; then
                cp "$db_file" "${NANOBOT_HOME}/"
                log_info "Restored database: $(basename $db_file)"
            fi
        done

        # Restore config files
        for config_file in config.yml config.json interagent.yml; do
            if [[ -f "${nanobot_backup}/${config_file}" ]]; then
                cp "${nanobot_backup}/${config_file}" "${NANOBOT_HOME}/"
                log_info "Restored: ${config_file}"
            fi
        done

        log_info "Nanobot data restored"
    else
        log_warn "No Nanobot data backup found"
    fi
}

# =============================================================================
# Main
# =============================================================================

main() {
    local backup_dir="$1"

    if [[ -z "$backup_dir" ]]; then
        log_error "Usage: $0 <backup_directory>"
        log_error ""
        log_error "Available backups:"
        ls -dt ${BACKUP_DIR:-/backups}/20* 2>/dev/null | head -5 || echo "  No backups found"
        exit 1
    fi

    log_info "=========================================="
    log_info "Interagent Restore Script v1.0.0"
    log_info "=========================================="
    log_info "Backup directory: ${backup_dir}"
    log_info "Automaton home: ${AUTOMATON_HOME}"
    log_info "Nanobot home: ${NANOBOT_HOME}"
    log_info ""

    # Show manifest
    show_manifest "$backup_dir"

    # Confirm restore
    read -p "Proceed with restore? (y/N): " confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        log_info "Restore cancelled"
        exit 0
    fi

    # Verify backup
    verify_backup "$backup_dir"

    # Run restores
    restore_automaton_database "$backup_dir"
    restore_automaton_keys "$backup_dir"
    restore_automaton_config "$backup_dir"
    restore_nanobot_data "$backup_dir"

    log_info ""
    log_info "=========================================="
    log_info "Restore completed successfully!"
    log_info "Please restart services to apply changes"
    log_info "=========================================="
}

# Run main function
main "$@"
