#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  source "$HOME/.nvm/nvm.sh"
  nvm use
fi
exec npm run dev
