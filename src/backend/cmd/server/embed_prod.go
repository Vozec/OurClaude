//go:build prod

package main

import "embed"

// frontend/dist is populated during Docker build (Stage 1 copies dist here).
//
//go:embed all:frontend/dist
var embeddedFrontend embed.FS
