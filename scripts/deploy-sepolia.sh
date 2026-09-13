#!/usr/bin/env bash
# Foundry auto-loads .env from the Foundry project root (contracts/), not the repo
# root where this project keeps its single .env. Rather than duplicate secrets into
# a second file, load the one .env here and hand forge an already-populated env.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "no .env at repo root — copy .env.example and fill it in"; exit 1; }
set -a; . ./.env; set +a

for v in SEPOLIA_RPC DEPLOYER_PK PROBER_ADDRESS CRE_FORWARDER ETH_REGISTRY; do
  [ -n "${!v:-}" ] || { echo "missing $v in .env — see .env.example"; exit 1; }
done

VERIFY=""
[ -n "${ETHERSCAN_API_KEY:-}" ] && VERIFY="--verify"

cd contracts
exec forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$SEPOLIA_RPC" \
  --private-key "$DEPLOYER_PK" \
  --broadcast $VERIFY "$@"
