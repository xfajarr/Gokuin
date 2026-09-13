.PHONY: build pack run run-clean run-sandwich run-known-clean protogen clean

# Rust target for a Substreams WASM module.
TARGET := wasm32-unknown-unknown
WASM := target/$(TARGET)/release/sandwich_detect.wasm
PKG := sandwich-detect-v0.1.0.spkg

# Public Ethereum mainnet firehose endpoint. Override with your own
# StreamingFast / substreams.dev key: `make run ENDPOINT=... TOKEN=...`
ENDPOINT ?= mainnet.eth.streamingfast.io:443

build: ## Compile the Rust module to WASM (requires: rustup target add wasm32-unknown-unknown)
	cargo build --target $(TARGET) --release

# `make pack` used to die with a bare 'No such file or directory' when the CLI was
# absent, which reads like a broken Makefile rather than a missing tool.
check-cli:
	@command -v substreams >/dev/null 2>&1 || { \
	  echo "substreams CLI not found."; \
	  echo "  brew install streamingfast/tap/substreams"; \
	  echo "  or: https://github.com/streamingfast/substreams/releases"; \
	  exit 1; }

pack: check-cli build ## Produce the .spkg the subgraph datasource and `substreams gui/run` consume
	substreams pack ./substreams.yaml -o $(PKG)

run: pack ## Stream map_sandwiches over a block range: make run BLOCKS=12300000:12300100
	substreams run -e $(ENDPOINT) $(PKG) map_sandwiches -s $(BLOCKS)

run-sandwich: pack ## Run against the known historical sandwich fixture (see fixtures/known-sandwich.md)
	substreams run -e $(ENDPOINT) $(PKG) map_sandwiches -s 22450093 -t +1

run-clean: pack ## Run against the known clean-block fixture (see fixtures/known-clean.md)
	substreams run -e $(ENDPOINT) $(PKG) map_sandwiches -s 22450094 -t +1

protogen: ## (Optional) regenerate Rust bindings from proto/*.proto via the substreams CLI instead of build.rs
	substreams protogen ./substreams.yaml --exclude-paths="sf,google"

clean:
	cargo clean
	rm -f $(PKG)

FIXTURE_POOL := 0x8d02988296949cd054623802c1115973a9afe307

verify-fixtures: pack ## Assert both fixtures. Needs SUBSTREAMS_API_KEY.
	@echo "→ 22450093 must detect the fixture-pool sandwich"
	@substreams run $(PKG) map_sandwiches -e $(ENDPOINT) -s 22450093 -t +1 2>/dev/null \
	  | grep -q '$(FIXTURE_POOL)' \
	  && echo "  ✓ found" || { echo "  ✗ MISSING — detector regressed"; exit 1; }
	@echo "→ 22450094 must NOT detect anything in the fixture pool"
	@echo "   (other pools in that block DO contain sandwiches — see fixtures/known-clean.md)"
	@substreams run $(PKG) map_sandwiches -e $(ENDPOINT) -s 22450094 -t +1 2>/dev/null \
	  | grep -q '$(FIXTURE_POOL)' \
	  && { echo "  ✗ FALSE POSITIVE in a quiet pool"; exit 1; } || echo "  ✓ clean"
