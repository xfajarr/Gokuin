#!/usr/bin/env bash
# Runs after you own the parent name and have transferred it to RouteRegistry.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "no .env at repo root"; exit 1; }
set -a; . ./.env; set +a
for v in SEPOLIA_RPC DEPLOYER_PK ROUTE_REGISTRY_ADDRESS ETH_REGISTRY; do
  [ -n "${!v:-}" ] || { echo "missing $v in .env — ROUTE_REGISTRY_ADDRESS comes from the deploy output"; exit 1; }
done
cd contracts
exec forge script script/RegisterRoutes.s.sol:RegisterRoutes \
  --rpc-url "$SEPOLIA_RPC" --private-key "$DEPLOYER_PK" --broadcast "$@"
