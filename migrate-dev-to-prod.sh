#!/bin/bash
#
# One-shot: copy data from local dev Postgres to Neon prod.
# Assumes prod schema already exists (run migrations.sh --prod --run first).
#
# Skips: users, data_room_connections (Firebase UIDs differ, encrypted creds invalid).
# After import: creates the prod user and reassigns all ownership.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${PROJECT_ROOT}/backend"

# Load dev DATABASE_URL
load_env_file() {
    local env_file="$1"
    if [ -f "$env_file" ]; then
        set -a
        while IFS= read -r line || [ -n "$line" ]; do
            [[ "$line" =~ ^[[:space:]]*# ]] && continue
            [[ -z "${line// }" ]] && continue
            export "$line" 2>/dev/null || true
        done < "$env_file"
        set +a
        return 0
    fi
    return 1
}

if ! load_env_file "${BACKEND_DIR}/.env.development"; then
    log_error ".env.development not found"
    exit 1
fi
LOCAL_DATABASE_URL="${DATABASE_URL:-}"

# Reset and load prod admin URL (avoid leaking dev DATABASE_URL into prod context)
unset DATABASE_URL
if ! load_env_file "${BACKEND_DIR}/.env.production"; then
    log_error ".env.production not found"
    exit 1
fi
PROD_DATABASE_ADMIN_URL="${DATABASE_ADMIN_URL:-}"

if [ -z "$LOCAL_DATABASE_URL" ]; then
    log_error "DATABASE_URL not set in .env.development"
    exit 1
fi

if [ -z "$PROD_DATABASE_ADMIN_URL" ]; then
    log_error "DATABASE_ADMIN_URL not set in .env.production"
    exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
    log_error "pg_dump not found — install postgresql client tools"
    exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
    log_error "psql not found — install postgresql client tools"
    exit 1
fi

# Collect prod user info
echo ""
log_info "We need to create your prod user and reassign all data to them."
log_info "Firebase UID will be linked automatically on first sign-in (matched by email)."
read -p "Name (e.g. Sam Padilla): " PROD_USER_NAME
read -p "Email (e.g. sam@incite.ventures): " PROD_USER_EMAIL

if [ -z "$PROD_USER_NAME" ] || [ -z "$PROD_USER_EMAIL" ]; then
    log_error "Both fields are required."
    exit 1
fi

echo ""
log_warning "This will:"
log_warning "  1. Copy all data EXCEPT users and data_room_connections"
log_warning "  2. Create user: ${PROD_USER_EMAIL} (Firebase UID linked on first login)"
log_warning "  3. Reassign all cases + case_members to that user"
log_warning "  Source: $(echo "$LOCAL_DATABASE_URL" | sed 's|://[^@]*@|://***@|')"
log_warning "  Target: $(echo "$PROD_DATABASE_ADMIN_URL" | sed 's|://[^@]*@|://***@|')"
echo ""
read -p "Type 'yes' to continue: " confirmation
if [ "$confirmation" != "yes" ]; then
    log_info "Cancelled"
    exit 0
fi

log_info "Dumping data-only from local Postgres (excluding users, data_room_connections, migrations)..."
DUMP_FILE=$(mktemp -t daubert-dump.XXXXXX.sql)
trap 'rm -f "$DUMP_FILE"' EXIT

pg_dump \
    --data-only \
    --disable-triggers \
    --no-owner \
    --no-privileges \
    --exclude-table=migrations \
    --exclude-table=users \
    --exclude-table=data_room_connections \
    "$LOCAL_DATABASE_URL" \
    > "$DUMP_FILE"

DUMP_SIZE=$(wc -c < "$DUMP_FILE" | tr -d ' ')
log_info "Dump complete: ${DUMP_SIZE} bytes"

log_info "Loading data into Neon prod..."
psql --single-transaction --set ON_ERROR_STOP=on "$PROD_DATABASE_ADMIN_URL" < "$DUMP_FILE"

log_info "Creating prod user and reassigning ownership..."
psql --set ON_ERROR_STOP=on "$PROD_DATABASE_ADMIN_URL" <<SQL
BEGIN;

-- Create the prod user (firebase_uid linked automatically on first sign-in via email match)
INSERT INTO users (id, name, email, created_at, updated_at)
VALUES (uuid_generate_v4(), '${PROD_USER_NAME}', '${PROD_USER_EMAIL}', now(), now());

-- Reassign all cases to the new user
UPDATE cases SET user_id = (SELECT id FROM users WHERE email = '${PROD_USER_EMAIL}');

-- Reassign all case_members to the new user
UPDATE case_members SET user_id = (SELECT id FROM users WHERE email = '${PROD_USER_EMAIL}');

COMMIT;
SQL

log_success "Data migration complete"
log_info "Skipped: users (new user created), data_room_connections (reconnect via OAuth in prod)"
