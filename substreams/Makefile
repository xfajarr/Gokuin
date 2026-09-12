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

pack: build ## Produce the .spkg the subgraph datasource and `substreams gui/run` consume
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
