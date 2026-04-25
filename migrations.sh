#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script lives at the repo root
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${PROJECT_ROOT}/backend"

# Change to backend directory for all operations
cd "${BACKEND_DIR}" || {
    echo "Error: Could not change to backend directory: ${BACKEND_DIR}"
    exit 1
}

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Default environment
NODE_ENV="development"

# Parse --dev or --prod flag
POSITIONAL=()

for arg in "$@"; do
  case $arg in
    --dev)
      NODE_ENV="development"
      shift
      ;;
    --prod)
      NODE_ENV="production"
      shift
      ;;
    *)
      POSITIONAL+=("$arg")
      ;;
  esac
done
set -- "${POSITIONAL[@]}"

# Export NODE_ENV
export NODE_ENV=$NODE_ENV

# Function to safely load environment variables from .env file
load_env_file() {
    local env_file="$1"
    if [ -f "$env_file" ]; then
        set -a
        while IFS= read -r line || [ -n "$line" ]; do
            # Skip empty lines and comments
            [[ "$line" =~ ^[[:space:]]*# ]] && continue
            [[ -z "${line// }" ]] && continue
            # Export the line (handles values with special characters)
            export "$line" 2>/dev/null || true
        done < "$env_file"
        set +a
        return 0
    fi
    return 1
}

# Load environment file based on NODE_ENV
if [ "$NODE_ENV" = "production" ]; then
    if load_env_file "${BACKEND_DIR}/.env.production"; then
        log_info "Loaded .env.production file for production"
    else
        log_error "Production environment file (.env.production) not found"
        exit 1
    fi
else
    if load_env_file "${BACKEND_DIR}/.env.development"; then
        log_info "Loaded .env.development file for development"
    else
        log_error ".env.development not found"
        exit 1
    fi
fi

# Data source path for CLI operations
CLI_DATA_SOURCE="src/database/cli-data-source.ts"

# Help message
show_help() {
    echo "Usage: ./migrations.sh [--dev|--prod] [OPTION]"
    echo "Database migration script for Daubert"
    echo ""
    echo "Options:"
    echo "  -r, --run       Run all pending migrations"
    echo "  -d, --dry-run   Show what migrations would be run without executing them"
    echo "  -f, --fake      Mark migrations as executed without running SQL (useful for manual fixes)"
    echo "  -a, --apply     Apply a specific migration (requires migration name)"
    echo "  -e, --create-empty  Create a new empty migration file (requires migration name)"
    echo "  -g, --generate  Generate a migration based on entity changes (requires migration name)"
    echo "  -t, --truncate  Truncate migrations table (resets migration history)"
    echo "  -c, --check     Check setup and verify environment configuration"
    echo "  -h, --help      Show this help message"
    echo ""
    echo "Environment:"
    echo "  --dev           Use local development database with .env.development (default)"
    echo "  --prod          Use production database with .env.production (DATABASE_ADMIN_URL)"
    echo ""
    echo "Examples:"
    echo "  ./migrations.sh --dev --run                # Run migrations on local database"
    echo "  ./migrations.sh --prod --generate Schema   # Generate migration against prod DB"
    echo "  ./migrations.sh --prod --run               # Apply pending migrations to prod"
    echo "  ./migrations.sh --check                    # Check setup and environment"
}

# Ensure migrations directory exists
ensure_migrations_dir() {
    if [ ! -d "src/database/migrations" ]; then
        log_warning "Creating migrations directory..."
        mkdir -p src/database/migrations
    fi
}

# Run migrations
run_migrations() {
    log_info "Running migrations in ${NODE_ENV} environment..."
    log_info "Using data source: ${CLI_DATA_SOURCE}"

    if [ "$NODE_ENV" = "production" ]; then
        log_warning "⚠️  PRODUCTION migration — showing pending migrations first:"
        echo ""
        NODE_ENV=$NODE_ENV npx ts-node ./node_modules/typeorm/cli.js migration:show -d "${CLI_DATA_SOURCE}"
        echo ""
        read -p "$(echo -e "${YELLOW}Run these migrations on PRODUCTION? Type 'yes' to confirm: ${NC}")" confirmation
        if [ "$confirmation" != "yes" ]; then
            log_info "Migration cancelled"
            exit 0
        fi
    fi

    NODE_ENV=$NODE_ENV npx ts-node ./node_modules/typeorm/cli.js migration:run -d "${CLI_DATA_SOURCE}"
    if [ $? -eq 0 ]; then
        log_success "Migrations completed successfully in ${NODE_ENV} environment"
    else
        log_error "Migration failed in ${NODE_ENV} environment"
        exit 1
    fi
}

# Dry run migrations
dry_run_migrations() {
    log_info "Performing dry run of migrations in ${NODE_ENV} environment..."
    log_info "Using data source: ${CLI_DATA_SOURCE}"

    export TYPEORM_LOGGING=true
    export TYPEORM_LOGGER=advanced-console

    NODE_ENV=$NODE_ENV npx ts-node ./node_modules/typeorm/cli.js migration:show -d "${CLI_DATA_SOURCE}"
    if [ $? -eq 0 ]; then
        log_success "Dry run completed successfully in ${NODE_ENV} environment"
    else
        log_error "Dry run failed in ${NODE_ENV} environment"
        exit 1
    fi
}

# Apply specific migration
apply_migration() {
    if [ -z "$1" ]; then
        log_error "Migration name is required for --apply"
        show_help
        exit 1
    fi

    log_info "Applying migration $1 in ${NODE_ENV} environment..."
    log_info "Using data source: ${CLI_DATA_SOURCE}"

    NODE_ENV=$NODE_ENV npx ts-node ./node_modules/typeorm/cli.js migration:run -d "${CLI_DATA_SOURCE}"
    if [ $? -eq 0 ]; then
        log_success "Migration $1 applied successfully in ${NODE_ENV} environment"
    else
        log_error "Failed to apply migration $1 in ${NODE_ENV} environment"
        exit 1
    fi
}

# Fake run migrations (mark as executed without running SQL)
fake_run_migrations() {
    log_warning "⚠️  WARNING: This will mark migrations as executed WITHOUT running the actual SQL!"
    log_warning "⚠️  This is useful when your database schema already matches the migration"
    log_warning "⚠️  This will affect your ${NODE_ENV} database"
    echo ""

    read -p "Type 'yes' to confirm you want to fake-run migrations in ${NODE_ENV} environment: " confirmation

    if [ "$confirmation" != "yes" ]; then
        log_info "Fake-run operation cancelled for ${NODE_ENV} environment"
        exit 0
    fi

    log_info "Fake running migrations in ${NODE_ENV} environment..."
    log_info "Using data source: ${CLI_DATA_SOURCE}"

    NODE_ENV=$NODE_ENV npx ts-node ./node_modules/typeorm/cli.js migration:run -d "${CLI_DATA_SOURCE}" --fake
    if [ $? -eq 0 ]; then
        log_success "Migrations fake-run completed successfully in ${NODE_ENV} environment"
        log_info "Migration history updated - no actual database changes were made"
    else
        log_error "Fake run failed in ${NODE_ENV} environment"
        exit 1
    fi
}

# Create empty migration
create_empty_migration() {
    if [ -z "$1" ]; then
        log_error "Migration name is required for --create-empty"
        show_help
        exit 1
    fi

    log_info "Creating new empty migration: $1"

    local timestamp=$(date +%s)000
    local class_name="${1}${timestamp}"
    local file_name="src/database/migrations/${timestamp}-${1}.ts"

    cat > "$file_name" << 'MIGRATION_TEMPLATE'
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CLASS_NAME implements MigrationInterface {
  name = 'CLASS_NAME';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add your migration queries here
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Add your rollback queries here
  }
}
MIGRATION_TEMPLATE

    sed -i.bak "s/CLASS_NAME/${class_name}/g" "$file_name" && rm -f "${file_name}.bak"

    if [ -f "$file_name" ]; then
        log_success "Empty migration file created: $file_name"
    else
        log_error "Failed to create empty migration file"
        exit 1
    fi
}

# Generate migration from entities
generate_migration() {
    if [ -z "$1" ]; then
        log_error "Migration name is required for --generate"
        show_help
        exit 1
    fi

    log_info "Generating migration '$1' in ${NODE_ENV} environment..."
    log_info "Using data source: ${CLI_DATA_SOURCE}"

    NODE_ENV=$NODE_ENV npx ts-node ./node_modules/typeorm/cli.js migration:generate "src/database/migrations/$1" -d "${CLI_DATA_SOURCE}"
    if [ $? -eq 0 ]; then
        log_success "Migration generated successfully in ${NODE_ENV} environment"
    else
        log_error "Failed to generate migration in ${NODE_ENV} environment"
        exit 1
    fi
}

# Truncate migrations table
truncate_migrations() {
    log_warning "⚠️  WARNING: This will reset your migration history!"
    log_warning "⚠️  All migrations will be marked as 'not run'"
    log_warning "⚠️  This is IRREVERSIBLE and will affect your ${NODE_ENV} database"
    log_warning "⚠️  Environment: ${NODE_ENV}"
    echo ""

    read -p "Type 'yes' to confirm you want to truncate the migrations table in ${NODE_ENV} environment: " confirmation

    if [ "$confirmation" != "yes" ]; then
        log_info "Truncate operation cancelled for ${NODE_ENV} environment"
        exit 0
    fi

    log_info "Truncating migrations table in ${NODE_ENV} environment..."
    log_info "Using data source: ${CLI_DATA_SOURCE}"

    NODE_ENV=$NODE_ENV npx ts-node ./node_modules/typeorm/cli.js query "DELETE FROM migrations;" -d "${CLI_DATA_SOURCE}"
    if [ $? -eq 0 ]; then
        log_success "Migrations table truncated successfully in ${NODE_ENV} environment"
        log_info "Migration history has been reset in ${NODE_ENV} environment"
    else
        log_error "Failed to truncate migrations table in ${NODE_ENV} environment"
        exit 1
    fi
}

# Check setup and verify environment configuration
check_setup() {
    log_info "Checking setup and verifying environment configuration..."
    log_info "Environment: ${NODE_ENV}"

    # Check if environment file exists
    if [ "$NODE_ENV" = "production" ]; then
        if [ -f "${BACKEND_DIR}/.env.production" ]; then
            log_success "Production environment file (.env.production) found"
        else
            log_error "Production environment file (.env.production) not found"
            return 1
        fi
    else
        if [ -f "${BACKEND_DIR}/.env.development" ]; then
            log_success "Development environment file (.env.development) found"
        else
            log_error "Development environment file (.env.development) not found"
            return 1
        fi
    fi

    # Check if CLI data source file exists
    if [ -f "${CLI_DATA_SOURCE}" ]; then
        log_success "CLI data source file found: ${CLI_DATA_SOURCE}"
    else
        log_error "CLI data source file not found: ${CLI_DATA_SOURCE}"
        return 1
    fi

    # Check if migrations directory exists
    if [ -d "src/database/migrations" ]; then
        log_success "Migrations directory exists: src/database/migrations"
        migration_count=$(find src/database/migrations -name "*.ts" -o -name "*.js" 2>/dev/null | wc -l | tr -d ' ')
        log_info "Found ${migration_count} migration files"
    else
        log_warning "Migrations directory does not exist: src/database/migrations"
    fi

    # Check if entities directory exists
    if [ -d "src/database/entities" ]; then
        log_success "Entities directory exists: src/database/entities"
        entity_count=$(find src/database/entities -name "*.entity.ts" -o -name "*.entity.js" 2>/dev/null | wc -l | tr -d ' ')
        log_info "Found ${entity_count} entity files"
    else
        log_error "Entities directory not found: src/database/entities"
        return 1
    fi

    # Check if required environment variables are loaded
    log_info "Checking required environment variables..."

    if [ "$NODE_ENV" = "production" ]; then
        if [ -n "${DATABASE_ADMIN_URL}" ]; then
            log_success "DATABASE_ADMIN_URL is set (length: ${#DATABASE_ADMIN_URL})"
        else
            log_error "DATABASE_ADMIN_URL is not set for production"
            return 1
        fi
    else
        if [ -n "${DATABASE_URL}" ]; then
            log_success "DATABASE_URL is set"
        else
            log_error "DATABASE_URL is not set for development"
            return 1
        fi
    fi

    if command -v npx >/dev/null 2>&1; then
        log_success "npx is available"
    else
        log_error "npx is not available"
        return 1
    fi

    log_success "Setup check completed successfully!"
    log_info "Environment: ${NODE_ENV}"
    if [ "$NODE_ENV" = "production" ]; then
        log_info "Database: Production (Neon PostgreSQL via DATABASE_ADMIN_URL)"
    else
        log_info "Database: Development (PostgreSQL via DATABASE_URL)"
    fi
}

# Main script
log_info "Starting migrations script"
log_info "Environment: ${NODE_ENV}"
if [ "$NODE_ENV" = "production" ]; then
    log_info "Database: Production (Neon PostgreSQL via DATABASE_ADMIN_URL)"
else
    log_info "Database: Development (PostgreSQL via DATABASE_URL)"
fi
ensure_migrations_dir

case "$1" in
    -r|--run)
        run_migrations
        ;;
    -d|--dry-run)
        dry_run_migrations
        ;;
    -f|--fake)
        fake_run_migrations
        ;;
    -a|--apply)
        apply_migration "$2"
        ;;
    -e|--create-empty)
        create_empty_migration "$2"
        ;;
    -g|--generate)
        generate_migration "$2"
        ;;
    -t|--truncate)
        truncate_migrations
        ;;
    -c|--check)
        check_setup
        ;;
    -h|--help|*)
        show_help
        ;;
esac
