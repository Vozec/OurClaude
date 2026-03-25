package metrics

import "github.com/prometheus/client_golang/prometheus"

var (
	RequestsTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "claude_proxy_requests_total",
		Help: "Total number of proxied requests.",
	}, []string{"model", "status"})

	RequestDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "claude_proxy_request_duration_ms",
		Help:    "Request duration in milliseconds.",
		Buckets: []float64{100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000},
	}, []string{"model"})

	TTFT = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "claude_proxy_ttft_ms",
		Help:    "Time to first token in milliseconds (streaming only).",
		Buckets: []float64{50, 100, 250, 500, 1000, 2500, 5000},
	}, []string{"model"})

	TokensTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "claude_proxy_tokens_total",
		Help: "Total tokens processed.",
	}, []string{"type"}) // input, output, cache_read, cache_write

	ActiveAccounts = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "claude_proxy_active_accounts",
		Help: "Number of Claude accounts by status.",
	}, []string{"status"})
)

func init() {
	prometheus.MustRegister(
		RequestsTotal,
		RequestDuration,
		TTFT,
		TokensTotal,
		ActiveAccounts,
	)
}
