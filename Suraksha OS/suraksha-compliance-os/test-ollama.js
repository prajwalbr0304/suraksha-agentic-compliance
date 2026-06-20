/* eslint-disable @typescript-eslint/no-require-imports */
const http = require("node:http");

const MODEL = process.argv[2] || "qwen2.5:1.5b";
console.log("Testing Ollama streaming with model:", MODEL);

const body = JSON.stringify({
  model: MODEL,
  messages: [
    {
      role: "system",
      content: "You extract compliance obligations. Always respond with valid JSON only."
    },
    {
      role: "user",
      content: "Extract obligations from: Banks must submit monthly liquidity reports by the 10th. Banks must maintain KYC records for 5 years. Respond ONLY with JSON: {\"regulation_name\":\"...\",\"jurisdiction\":\"India - RBI\",\"document_summary\":\"...\",\"obligations\":[{\"obligation_text\":\"...\",\"department\":\"...\",\"priority\":\"high\",\"deadline\":null,\"evidence_required\":[\"...\"],\"citation\":\"Para 1\",\"confidence\":85,\"compliance_risk\":\"high\"}]}"
    }
  ],
  stream: true,
  format: "json",
  options: { temperature: 0.1, num_predict: 512 },
});

const start = Date.now();
let tokenCount = 0;
let accumulated = "";

const req = http.request(
  { hostname: "localhost", port: 11434, path: "/api/chat", method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Connection: "keep-alive" } },
  (res) => {
    console.log("HTTP status:", res.statusCode);
    let lineBuffer = "";
    res.on("data", (chunk) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          const token = obj.message?.content ?? "";
          accumulated += token;
          tokenCount++;
          process.stdout.write(token);
          if (obj.done) {
            const elapsed = (Date.now() - start) / 1000;
            console.log("\n\n=== DONE ===");
            console.log(`Tokens: ${tokenCount}, Time: ${elapsed.toFixed(1)}s, Speed: ${(tokenCount/elapsed).toFixed(1)} tok/sec`);
            console.log("Full response length:", accumulated.length);
            try { JSON.parse(accumulated); console.log("VALID JSON: yes"); }
            catch { console.log("VALID JSON: no"); }
          }
        } catch { /* incomplete line */ }
      }
    });
    res.on("end", () => {
      if (!accumulated) console.log("\nNo content received");
    });
    res.on("error", (e) => console.error("res error:", e.message));
  }
);

req.setTimeout(600000, () => req.destroy(new Error("timeout")));
req.on("error", (e) => console.error("req error:", e.message));
req.write(body);
req.end();
