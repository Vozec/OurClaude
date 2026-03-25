.PHONY: up down build ourclaude install-ourclaude

# Docker
up:
	docker compose up --build

down:
	docker compose down

build:
	docker compose build

# Build ourclaude client binary (current platform)
ourclaude:
	cd src/backend && CGO_ENABLED=0 go build -ldflags="-s -w" -o ../../dist/ourclaude ./cmd/cl/
	@echo "Built: dist/ourclaude"

# Build ourclaude for all common platforms
ourclaude-all:
	mkdir -p dist
	cd src/backend && \
	GOOS=linux   GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ../../dist/ourclaude-linux-amd64   ./cmd/cl/ && \
	GOOS=linux   GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ../../dist/ourclaude-linux-arm64   ./cmd/cl/ && \
	GOOS=darwin  GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ../../dist/ourclaude-darwin-amd64  ./cmd/cl/ && \
	GOOS=darwin  GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ../../dist/ourclaude-darwin-arm64  ./cmd/cl/ && \
	GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ../../dist/ourclaude-windows-amd64.exe ./cmd/cl/
	@echo "Built all platforms in dist/"

# Install ourclaude to /usr/local/bin
install-ourclaude: ourclaude
	install -m 755 dist/ourclaude /usr/local/bin/ourclaude
	@echo "Installed: /usr/local/bin/ourclaude"
	@echo "Run: ourclaude login <server_url>"

# Uninstall
uninstall-ourclaude:
	rm -f /usr/local/bin/ourclaude
	@echo "Uninstalled ourclaude"
