package proxy

import "encoding/json"

// cacheInjectThreshold is the minimum estimated token count for a block to
// receive a cache_control marker. Anthropic's minimum cacheable size is 1024 tokens.
const cacheInjectThreshold = 1024

// estimateTokens approximates the token count of a string (4 chars ≈ 1 token).
func estimateTokens(s string) int {
	return len(s) / 4
}

// injectPromptCache rewrites a Messages API request body to add
// cache_control: {"type":"ephemeral"} on eligible blocks:
//   - system prompt (string or content-block array) if > cacheInjectThreshold tokens
//   - last tool definition if the total tools size > cacheInjectThreshold tokens
// Returns the original body unmodified if it cannot be parsed or no injection
// is needed.
func injectPromptCache(body []byte) []byte {
	var req map[string]json.RawMessage
	if err := json.Unmarshal(body, &req); err != nil {
		return body
	}

	modified := false

	// ── System prompt ────────────────────────────────────────────────────────
	if sys, ok := req["system"]; ok {
		var strVal string
		if json.Unmarshal(sys, &strVal) == nil {
			// String form → convert to content-block array with cache_control.
			if estimateTokens(strVal) >= cacheInjectThreshold {
				block := map[string]interface{}{
					"type":          "text",
					"text":          strVal,
					"cache_control": map[string]string{"type": "ephemeral"},
				}
				if raw, err := json.Marshal([]interface{}{block}); err == nil {
					req["system"] = raw
					modified = true
				}
			}
		} else {
			// Array form → add cache_control to the last element.
			var arrVal []map[string]json.RawMessage
			if json.Unmarshal(sys, &arrVal) == nil && len(arrVal) > 0 {
				// Estimate tokens from the raw last block.
				lastRaw, _ := json.Marshal(arrVal[len(arrVal)-1])
				if estimateTokens(string(lastRaw)) >= cacheInjectThreshold {
					last := arrVal[len(arrVal)-1]
					last["cache_control"] = json.RawMessage(`{"type":"ephemeral"}`)
					arrVal[len(arrVal)-1] = last
					if raw, err := json.Marshal(arrVal); err == nil {
						req["system"] = raw
						modified = true
					}
				}
			}
		}
	}

	// ── Tools ────────────────────────────────────────────────────────────────
	if tools, ok := req["tools"]; ok {
		var toolsArr []map[string]json.RawMessage
		if json.Unmarshal(tools, &toolsArr) == nil && len(toolsArr) > 0 {
			if estimateTokens(string(tools)) >= cacheInjectThreshold {
				last := toolsArr[len(toolsArr)-1]
				last["cache_control"] = json.RawMessage(`{"type":"ephemeral"}`)
				toolsArr[len(toolsArr)-1] = last
				if raw, err := json.Marshal(toolsArr); err == nil {
					req["tools"] = raw
					modified = true
				}
			}
		}
	}

	if !modified {
		return body
	}

	result, err := json.Marshal(req)
	if err != nil {
		return body
	}
	return result
}
