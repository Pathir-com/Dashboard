-- Voice agents were listing services without their prices, even though the
-- prices are already in the agent's catalog context. Add an explicit rule
-- (both verticals) to always quote the price when a service comes up.
--
-- Targeted replace() on the shared Rules line so we don't re-paste (and risk
-- drifting) the whole prompt. The same line exists in both the dental and
-- hair_transplant prompts (migration 024).
--
-- 2026-05-23

UPDATE industry_templates
SET agent_system_prompt = replace(
      agent_system_prompt,
      '- ONLY state facts from tool responses. Never guess prices, services, practitioners, or hours.',
      '- ONLY state facts from tool responses. Never guess prices, services, practitioners, or hours.' || chr(10) ||
      '- When a patient asks about a service (or which services you offer), ALWAYS state its price from the catalog in the same reply — don''t make them ask twice. If a service is free or consultation-only, say so.'
    ),
    updated_at = now()
WHERE id IN ('dental', 'hair_transplant')
  AND agent_system_prompt LIKE '%Never guess prices, services, practitioners, or hours.%';
