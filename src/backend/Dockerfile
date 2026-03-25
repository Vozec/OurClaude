# Stage 1: Build frontend
# Build context is the project root (set in docker-compose.yml)
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY src/frontend/package*.json ./
RUN npm ci
COPY src/frontend/ ./
RUN npm run build

# Stage 2: Build Go binary
FROM golang:1.25-alpine AS go-builder
RUN apk add --no-cache gcc musl-dev

WORKDIR /build

# Download Go dependencies
COPY src/backend/go.mod src/backend/go.sum ./
RUN go mod download

# Copy Go source
COPY src/backend/ ./

# Copy built frontend into the embed path
# The binary uses //go:embed all:frontend/dist in cmd/server/embed_prod.go
COPY --from=frontend-builder /app/dist ./cmd/server/frontend/dist/

# Build with prod tag so frontend is embedded
RUN CGO_ENABLED=1 GOOS=linux go build -tags prod \
    -ldflags="-s -w" \
    -o /claude-proxy ./cmd/server/

# Cross-compile ourclaude client (no CGO needed)
# Set CLI_PLATFORMS to a comma-separated list to compile only specific targets.
# Default: all. Example: CLI_PLATFORMS=linux-amd64
ARG CLI_PLATFORMS=linux-amd64,linux-arm64,darwin-amd64,darwin-arm64,windows-amd64
RUN mkdir -p /dist && \
    for p in $(echo "$CLI_PLATFORMS" | tr ',' ' '); do \
      os=$(echo "$p" | cut -d- -f1); \
      arch=$(echo "$p" | cut -d- -f2); \
      out="/dist/ourclaude-${p}"; \
      [ "$os" = "windows" ] && out="${out}.exe"; \
      echo "Building ${out}..."; \
      GOOS=$os GOARCH=$arch CGO_ENABLED=0 go build -ldflags="-s -w" -o "$out" ./cmd/cl/; \
    done

# Stage 3: Runtime image
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata wget curl bash

RUN mkdir -p /data /usr/local/share/cl

COPY --from=go-builder /claude-proxy /usr/local/bin/claude-proxy
COPY --from=go-builder /dist/ /usr/local/share/cl/

EXPOSE 3000 8080

ENTRYPOINT ["/usr/local/bin/claude-proxy"]
