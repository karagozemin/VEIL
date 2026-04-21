import "dotenv/config";

const missing = [];
if (!process.env.CLASH_LLM_API_KEY?.trim()) missing.push("CLASH_LLM_API_KEY");
if (!process.env.CLASH_LLM_BASE_URL?.trim()) missing.push("CLASH_LLM_BASE_URL");
if (!process.env.CLASH_LLM_MODEL?.trim()) missing.push("CLASH_LLM_MODEL");

if (missing.length) {
  console.log(JSON.stringify({ ok: false, reason: "missing_env", missing }, null, 2));
  process.exit(1);
}

const base = process.env.CLASH_LLM_BASE_URL.replace(/\/$/, "");
const key = process.env.CLASH_LLM_API_KEY;
const model = process.env.CLASH_LLM_MODEL;

const response = await fetch(`${base}/chat/completions`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`
  },
  body: JSON.stringify({
    model,
    temperature: 0,
    max_tokens: 3,
    messages: [{ role: "user", content: "Reply with ONLY OK" }]
  })
});

const text = await response.text();
let parsed;
try {
  parsed = JSON.parse(text);
} catch {
  parsed = null;
}

const contentPreview = parsed?.choices?.[0]?.message?.content?.trim() ?? null;

console.log(
  JSON.stringify(
    {
      ok: response.ok,
      status: response.status,
      model,
      contentPreview
    },
    null,
    2
  )
);

if (!response.ok) {
  process.exit(1);
}
