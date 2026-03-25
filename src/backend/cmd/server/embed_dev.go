//go:build !prod

package main

import "embed"

// In development, the frontend is served by Vite (npm run dev).
// This stub keeps the build working without a built frontend.
var embeddedFrontend embed.FS
