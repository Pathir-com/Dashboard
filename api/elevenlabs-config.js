/**
 * Purpose:
 *     Preview/export ElevenLabs agent configuration.
 *     GET /api/elevenlabs-config?clinic=Parkview+Dental&assistant=Myriam
 *
 * Used by:
 *     - Developer copy-paste into ElevenLabs dashboard
 *
 * Changes:
 *     2026-03-10: Initial creation
 */

import { ELEVENLABS_TOOLS, generateElevenLabsSystemPrompt } from "./_lib/elevenlabs-assistant-config.js";

export default function handler(req, res) {
  const clinicName = req.query.clinic || "Spark Dental Clinic";
  const assistantName = req.query.assistant || "Poppy";

  res.json({
    system_prompt: generateElevenLabsSystemPrompt(clinicName, assistantName),
    first_message: "",
    tools: ELEVENLABS_TOOLS,
    voice_settings: {
      voice: "Isla Skye - Authentic Scottish Female",
      tts_model: "V3 Conversational",
      suggested_audio_tags: ["Concerned", "Patient", "Enthusiastic", "Serious"],
    },
    instructions: {
      step_1: "Create a new agent in ElevenLabs dashboard",
      step_2: "Paste the system_prompt into the System Prompt field",
      step_3: "Leave First Message empty (agent calls lookup_caller_phone first)",
      step_4: "Set voice to Isla Skye - Authentic Scottish Female, V3 Conversational",
      step_5: "Add each tool from the tools array — name, description, parameters — and set webhook URL to the webhook_url value",
      step_6: "Set LLM to Gemini 2.5 Flash (or Claude if available)",
      step_7: "Enable Interruptible",
      step_8: "Connect your Twilio phone number under Deploy > Phone Numbers",
    },
  });
}
