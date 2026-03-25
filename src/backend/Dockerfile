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

# Cross-compile ourclaude client for all platforms (no CGO needed)
RUN GOOS=linux   GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o /dist/ourclaude-linux-amd64   ./cmd/cl/ && \
    GOOS=linux   GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w" -o /dist/ourclaude-linux-arm64   ./cmd/cl/ && \
    GOOS=darwin  GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o /dist/ourclaude-darwin-amd64  ./cmd/cl/ && \
    GOOS=darwin  GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w" -o /dist/ourclaude-darwin-arm64  ./cmd/cl/ && \
    GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o /dist/ourclaude-windows-amd64.exe ./cmd/cl/

# Stage 3: Runtime image
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata wget curl bash

RUN mkdir -p /data /usr/local/share/cl

COPY --from=go-builder /claude-proxy /usr/local/bin/claude-proxy
COPY --from=go-builder /dist/ /usr/local/share/cl/

EXPOSE 3000 8080

ENTRYPOINT ["/usr/local/bin/claude-proxy"]
