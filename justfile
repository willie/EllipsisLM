# EllipsisLM build tasks

# Default: show available commands
default:
    @just --list

# Extract modules from index.html into modular/
deconstruct:
    node scripts/deconstruct.js

# Preview deconstruct without writing files
deconstruct-dry:
    node scripts/deconstruct.js --dry-run

# Build index.html from modular/ files
reconstruct:
    node scripts/reconstruct.js

# Preview reconstruct without writing files
reconstruct-dry:
    node scripts/reconstruct.js --dry-run

# Pull latest changes from main branch
pull-main:
    git fetch origin main
    git merge origin/main --no-edit

# Sync from upstream: pull main and deconstruct to modular/
sync-from-upstream: pull-main deconstruct

# Build for distribution: reconstruct modular/ to index.html
build: reconstruct

# Serve the modular version locally
serve:
    go run modular/local.go
