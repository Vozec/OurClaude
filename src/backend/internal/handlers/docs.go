package handlers

import (
	_ "embed"
	"net/http"
)

//go:embed openapi.json
var openapiJSON []byte

// DocsUI serves the Swagger UI at /docs
func DocsUI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(docsHTML))
}

// DocsSpec serves the raw OpenAPI 3.0 spec at /docs/openapi.json
func DocsSpec(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Write(openapiJSON)
}

const docsHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OurClaude — API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #0f172a; }
    #swagger-ui { max-width: 1200px; margin: 0 auto; }
    .swagger-ui .topbar {
      background: linear-gradient(90deg, #0f172a 0%, #1e293b 100%);
      border-bottom: 1px solid #334155;
      padding: 10px 0;
    }
    .swagger-ui .topbar-wrapper img { display: none; }
    .swagger-ui .topbar-wrapper::before {
      content: '✦ OurClaude — API Docs';
      color: #e2e8f0;
      font-size: 18px;
      font-weight: 600;
      font-family: ui-monospace, monospace;
      padding-left: 20px;
    }
    .swagger-ui .topbar .download-url-wrapper { display: none; }
    .swagger-ui { color: #e2e8f0; }
    .swagger-ui .info { margin: 30px 0 20px; }
    .swagger-ui .info .title { color: #f8fafc; }
    .swagger-ui .info p, .swagger-ui .info li { color: #94a3b8; }
    .swagger-ui .scheme-container {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 20px;
    }
    .swagger-ui section.models { background: #1e293b; border-radius: 8px; }
    .swagger-ui .opblock-tag { color: #e2e8f0; border-bottom: 1px solid #334155; }
    .swagger-ui .opblock { border-radius: 6px; border: none; margin-bottom: 8px; }
    .swagger-ui .opblock .opblock-summary { border-radius: 6px; }
    .swagger-ui .opblock.opblock-get .opblock-summary { background: #0c4a6e22; border-left: 3px solid #0ea5e9; }
    .swagger-ui .opblock.opblock-post .opblock-summary { background: #14532d22; border-left: 3px solid #22c55e; }
    .swagger-ui .opblock.opblock-put .opblock-summary { background: #78350f22; border-left: 3px solid #f59e0b; }
    .swagger-ui .opblock.opblock-delete .opblock-summary { background: #7f1d1d22; border-left: 3px solid #ef4444; }
    .swagger-ui .opblock-summary-method { border-radius: 4px; font-weight: 700; min-width: 70px; }
    .swagger-ui .opblock-body { background: #1e293b; }
    .swagger-ui .model-box, .swagger-ui .model { background: #1e293b; }
    .swagger-ui input[type=text], .swagger-ui textarea, .swagger-ui select {
      background: #0f172a; color: #e2e8f0; border: 1px solid #475569;
    }
    .swagger-ui .btn { border-radius: 6px; }
    .swagger-ui .btn.execute { background: #6366f1; border-color: #6366f1; }
    .swagger-ui .btn.authorize { background: #0ea5e9; border-color: #0ea5e9; }
    .swagger-ui .responses-wrapper { background: #0f172a; }
    .swagger-ui table thead tr td, .swagger-ui table thead tr th { color: #94a3b8; border-bottom: 1px solid #334155; }
    .swagger-ui .parameter__name { color: #f8fafc; }
    .swagger-ui .parameter__type { color: #94a3b8; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/docs/openapi.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
      deepLinking: true,
      tryItOutEnabled: true,
      defaultModelsExpandDepth: 0,
      defaultModelExpandDepth: 2,
      displayRequestDuration: true,
      filter: true,
      withCredentials: true,
    })
  </script>
</body>
</html>`
