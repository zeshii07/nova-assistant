// Smoke test: streaming, unanswered logging, and lead capture through the public chat.
const { startServer } = require("../apps/api/src/server");
const http = require("http");

(async () => {
  const started = await startServer();
  const server = started.server;
  await new Promise((resolve) => {
    if (server.listening) return resolve();
    server.once("listening", resolve);
  });
  const port = server.address().port;

  function post(p, body) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request(`http://127.0.0.1:${port}${p}`, {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) }
      }, (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(buf || "{}") }); }
          catch { resolve({ status: res.statusCode, headers: res.headers, body: buf }); }
        });
      });
      req.on("error", reject);
      req.write(data);
      req.end();
    });
  }

  function postStream(p, body) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request(`http://127.0.0.1:${port}${p}`, {
        method: "POST",
        headers: { "content-type": "application/json", "accept": "text/event-stream", "content-length": Buffer.byteLength(data) }
      }, (res) => {
        const events = [];
        let buf = "";
        res.on("data", (chunk) => {
          buf += chunk.toString();
          // Parse complete SSE frames (separated by \n\n).
          const frames = buf.split("\n\n");
          buf = frames.pop(); // keep the last incomplete frame
          for (const frame of frames) {
            const lines = frame.split("\n");
            let event = "message", dataStr = "";
            for (const line of lines) {
              if (line.startsWith("event: ")) event = line.slice(7);
              else if (line.startsWith("data: ")) dataStr += line.slice(6);
            }
            if (dataStr) events.push({ event, data: JSON.parse(dataStr) });
          }
        });
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, events }));
      });
      req.on("error", reject);
      req.write(data);
      req.end();
    });
  }

  // 1. Test streaming.
  console.log("=== STREAMING TEST ===");
  const s = await postStream("/api/public/chat", { message: "What is Nova?", locale: "en", stream: true });
  console.log("status:", s.status, "content-type:", s.headers["content-type"]);
  const eventTypes = s.events.map((e) => e.event);
  console.log("events:", eventTypes.join(", "));
  const meta = s.events.find((e) => e.event === "meta");
  const deltas = s.events.filter((e) => e.event === "delta");
  const done = s.events.find((e) => e.event === "done");
  console.log("meta.outcome:", meta?.data?.outcome, "| meta.intent:", meta?.data?.intent);
  console.log("delta count:", deltas.length, "| full text:", deltas.map((d) => d.data.text).join("").slice(0, 80) + "...");
  console.log("done has suggested_actions:", Array.isArray(done?.data?.suggested_actions));

  // 2. Test unanswered-question logging (ask an obscure question that can't be answered).
  console.log("\n=== UNANSWERED LOGGING TEST ===");
  const obscure = await post("/api/public/chat", { message: "What is Nova's carbon footprint per transaction in 2027?", locale: "en" });
  console.log("obscure outcome:", obscure.body.outcome, "| reply:", String(obscure.body.reply).slice(0, 80));

  // 3. Test lead capture.
  console.log("\n=== LEAD CAPTURE TEST ===");
  const lead = await post("/api/public/lead", {
    conversation_id: "smoke-stream-1", name: "Stream Test", email: "stream@test.example",
    industry: "salon", demo_requested: true,
    consent: { contact_allowed: true, consent_text_version: "v1" }
  });
  console.log("lead ok:", lead.body.ok, "| lead_id:", lead.body.lead_id);

  server.closeAllConnections && server.closeAllConnections();
  server.close(() => {});
  await started.close().catch(() => {});
  setTimeout(() => process.exit(0), 200);
})();
