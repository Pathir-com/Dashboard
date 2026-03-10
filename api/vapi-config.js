import { VAPI_TOOLS, generateSystemPrompt } from "./_lib/vapi-assistant-config.js";

/**
 * GET /api/vapi-config?clinicName=...&assistantName=...
 *
 * Returns the VAPI tool definitions and system prompt for review.
 * Use this to copy/paste into the VAPI dashboard or to sync programmatically.
 */
export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const clinicName = req.query.clinicName || "the practice";
  const assistantName = req.query.assistantName || "Myriam";

  const prompt = generateSystemPrompt(clinicName, assistantName);

  return res.json({
    tools: VAPI_TOOLS,
    systemPrompt: prompt,
    promptLength: prompt.length,
    instructions: "Copy the systemPrompt into your VAPI assistant's system prompt, add the tools, and set the Server URL to your deployed /api/vapi-server-url endpoint.",
  });
}
