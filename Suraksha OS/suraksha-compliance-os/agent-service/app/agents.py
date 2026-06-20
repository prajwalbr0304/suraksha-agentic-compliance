"""Google ADK agents for the regulatory -> MAP pipeline.

Uses **Gemini** by default, or a **local Ollama** model via LiteLLM when
``SURAKSHA_USE_LOCAL_LLM=true`` (see ``config.py`` / README).

Agents:
  - obligation_extractor, map_generator, department_assigner (tools),
    evidence_validator, drift_analyzer, impact_assessor (tools), audit_summarizer.

A SequentialAgent (regulatory_pipeline) documents the end-to-end flow; the
orchestrator in pipeline.py drives the steps explicitly so it can persist to
Supabase between stages.
"""
from __future__ import annotations

import asyncio
import json
import re
import uuid

from . import ssl_fix  # noqa: F401 — must run before Google SDK imports

from google.adk.agents import LlmAgent, SequentialAgent
from google.adk.runners import InMemoryRunner
from google.genai import types

from . import config
from .tools import get_departments, get_open_map_cards

if config.USE_LOCAL_LLM:
    from google.adk.models.lite_llm import LiteLlm

    MODEL = LiteLlm(
        model=config.LOCAL_LLM_MODEL,
        api_base=config.LOCAL_LLM_API_BASE,
        drop_params=True,
        # Passed through to litellm ``acompletion`` — avoids default ~600s Ollama read timeout.
        timeout=config.LITELLM_HTTP_TIMEOUT_SEC,
        # Force valid JSON object output from local models (Ollama format=json). Every agent
        # below returns a JSON OBJECT, which keeps small local models (e.g. llama3.2) parseable
        # and prevents the "0 obligations / prose instead of JSON" failures seen with free text.
        response_format={"type": "json_object"},
    )
else:
    MODEL = config.GEMINI_MODEL

obligation_extractor = LlmAgent(
    name="obligation_extractor",
    model=MODEL,
    description="Extracts discrete compliance obligations from a regulatory change.",
    instruction=(
        "You are a banking compliance analyst. Given the text of a regulatory change "
        "(RBI/SEBI/PMLA), extract every discrete, actionable compliance obligation. "
        "Return ONLY a JSON object of the form {\"obligations\": [ ... ]} where each array item is "
        "{\"title\": str, \"description\": str, \"priority\": one of [critical,high,medium,low], "
        "\"risk\": one of [high,medium,low], \"citation\": str, \"suggested_department\": str}. "
        "If the text contains no actionable obligation, return {\"obligations\": []}. No prose, JSON only."
    ),
)

map_generator = LlmAgent(
    name="map_generator",
    model=MODEL,
    description="Turns an obligation into Measurable Action Points.",
    instruction=(
        "You convert a single compliance obligation into 1-3 Measurable Action Points (MAPs). "
        "Each MAP must be specific and measurable. Return ONLY a JSON array. Each item: "
        "{\"title\": str, \"metric\": str, \"target\": str, \"due_in_days\": int, "
        "\"evidence_required\": [str], \"priority\": one of [critical,high,medium,low]}. JSON only."
    ),
)

map_and_route_batch = LlmAgent(
    name="map_and_route_batch",
    model=MODEL,
    description="Generates MAPs with department routing for multiple obligations in one response.",
    instruction=(
        "You receive a JSON object with keys: allowed_departments (array of strings), "
        "obligations (array of {index:int, title:str, description:str, suggested_department:str}). "
        "For EACH obligation produce 1-3 Measurable Action Points (MAPs). "
        "Each MAP must include: title, metric, target, due_in_days (int), evidence_required (array of strings), "
        "priority (critical|high|medium|low), and department — department MUST be exactly one string from "
        "allowed_departments (use suggested_department when it matches; otherwise pick the best fit). "
        "Return ONLY JSON: {\"assignments\": [{\"obligation_index\": int, "
        "\"maps\": [{\"title\",\"metric\",\"target\",\"due_in_days\",\"evidence_required\",\"priority\",\"department\"}]}]}. "
        "No markdown, JSON only."
    ),
)

department_assigner = LlmAgent(
    name="department_assigner",
    model=MODEL,
    description="Assigns a MAP to the correct bank department.",
    instruction=(
        "You assign a Measurable Action Point to exactly one department of the bank. "
        "First call the get_departments tool to see which departments exist. "
        "Choose the single best-fit department from that list. "
        "Return ONLY JSON: {\"department\": str, \"rationale\": str}. JSON only."
    ),
    tools=[get_departments],
)

# RoutingAgent is the named identity for department_assigner (kept as an alias so
# the existing orchestrator references keep working).
routing_agent = department_assigner

evidence_validator = LlmAgent(
    name="evidence_validator",
    model=MODEL,
    description="Validates whether a MAP is complete based on collected evidence.",
    instruction=(
        "You validate completion of a Measurable Action Point. Given the MAP and the list of "
        "collected evidence items, decide if the evidence is sufficient. "
        "Return ONLY JSON: {\"complete\": bool, \"confidence\": int(0-100), "
        "\"reason\": str, \"missing\": [str]}. JSON only."
    ),
)

drift_analyzer = LlmAgent(
    name="drift_analyzer",
    model=MODEL,
    description="Detects regulatory drift between an earlier and a newer circular.",
    instruction=(
        "You compare two regulatory circulars (a base/older version and a new version) and "
        "summarise the drift. Return ONLY JSON: {\"summary\": str, \"new_obligations\": int, "
        "\"removed_obligations\": int, \"changed_obligations\": int, \"drift_score\": int(0-100), "
        "\"changes\": [{\"type\": one of [added,removed,changed], \"detail\": str}]}. JSON only."
    ),
)

impact_assessor = LlmAgent(
    name="impact_assessor",
    model=MODEL,
    description="Assesses the operational/audit impact of a regulatory change on a bank.",
    instruction=(
        "You assess the impact of a regulatory change on a bank. Given the regulation summary and "
        "the bank's departments, return ONLY JSON: {\"summary\": str, \"impacted_teams\": [str], "
        "\"risk_level\": one of [critical,high,medium,low], \"audit_risk\": one of [critical,high,medium,low], "
        "\"operational_risk\": one of [critical,high,medium,low], \"complexity\": one of [high,medium,low], "
        "\"estimated_weeks\": int, \"affected_controls\": [str]}. JSON only."
    ),
    tools=[get_departments],
)

audit_summarizer = LlmAgent(
    name="audit_summarizer",
    model=MODEL,
    description="Summarises recent agent/compliance activity into an audit-ready narrative.",
    instruction=(
        "You write a concise, audit-ready summary of recent compliance automation activity for a bank. "
        "Given a list of recent events, return ONLY JSON: {\"summary\": str, \"highlights\": [str], "
        "\"risks\": [str]}. JSON only."
    ),
)

pdf_url_resolver = LlmAgent(
    name="pdf_url_resolver",
    model=MODEL,
    description="Finds a direct PDF URL from a regulator notification HTML page.",
    instruction=(
        "You are given truncated HTML from a banking regulator notification page (RBI/SEBI/etc.) "
        "and metadata (page URL, title, regulator). Find the best direct HTTPS link to the official "
        "PDF circular or master direction. Return ONLY JSON: {\"pdf_url\": str | null}. "
        "The URL must be https and point to a .pdf file or a known regulator PDF CDN path. "
        "If uncertain, return {\"pdf_url\": null}. JSON only, no markdown."
    ),
)

regulation_tagger = LlmAgent(
    name="regulation_tagger",
    model=MODEL,
    description="Proposes category, tags, and a short executive summary for a regulatory change.",
    instruction=(
        "Given a regulation title, regulator name, and short summary or excerpt, propose inbox metadata. "
        "Return ONLY JSON: {\"category\": str, \"tags\": [str], \"executive_summary\": str}. "
        "Use 3-8 short lowercase tags; category is a single short label (e.g. KYC, Cyber, Capital). "
        "executive_summary must be under 400 characters. JSON only."
    ),
)

# Registry of named sub-agents the Coordinator can dispatch (for observability + /agents listing).
SUB_AGENTS = [
    {"name": "monitoring_agent", "role": "Regulatory feed monitoring", "writes": "regulatory_changes"},
    {"name": "obligation_extractor", "role": "Obligation extraction", "writes": "obligations"},
    {"name": "map_generator", "role": "MAP generation", "writes": "map_cards"},
    {"name": "map_and_route_batch", "role": "Batch MAP generation + department routing", "writes": "map_cards"},
    {"name": "routing_agent", "role": "Department assignment + escalation", "writes": "map_cards, escalations"},
    {"name": "evidence_validator", "role": "Evidence validation + readiness", "writes": "map_cards, readiness_scores"},
    {"name": "drift_analyzer", "role": "Regulatory drift detection", "writes": "drift_comparisons"},
    {"name": "impact_assessor", "role": "Impact assessment", "writes": "impact_simulations"},
    {"name": "audit_summarizer", "role": "Audit report generation", "writes": "audit_trail, audit_exports"},
    {"name": "pdf_url_resolver", "role": "LLM-assisted PDF URL discovery", "writes": "regulation_processing_log"},
    {"name": "regulation_tagger", "role": "Regulation inbox tagging", "writes": "regulatory_changes"},
]

# Documented end-to-end workflow. The Coordinator in coordinator.py drives steps
# explicitly so it can persist to Supabase and attribute events per sub-agent.
regulatory_pipeline = SequentialAgent(
    name="regulatory_pipeline",
    description="Regulatory change -> obligations -> MAPs -> department assignment.",
    sub_agents=[obligation_extractor, map_generator, department_assigner],
)


async def run_agent(agent: LlmAgent, prompt: str) -> str:
    """Run a single ADK agent and return its final text response."""
    floor = 120.0 if config.USE_LOCAL_LLM else 30.0
    # Outer asyncio guard must exceed LiteLLM's HTTP timeout to Ollama or litellm fails first.
    if config.USE_LOCAL_LLM:
        timeout = max(floor, float(config.AGENT_LLM_TIMEOUT_SEC), float(config.LITELLM_HTTP_TIMEOUT_SEC) + 120.0)
    else:
        timeout = max(floor, float(config.AGENT_LLM_TIMEOUT_SEC))

    async def _run() -> str:
        runner = InMemoryRunner(agent=agent, app_name="suraksha")
        user_id, session_id = "agent", str(uuid.uuid4())
        await runner.session_service.create_session(app_name="suraksha", user_id=user_id, session_id=session_id)
        final = ""
        async for event in runner.run_async(
            user_id=user_id,
            session_id=session_id,
            new_message=types.Content(role="user", parts=[types.Part(text=prompt)]),
        ):
            if event.is_final_response() and event.content and event.content.parts:
                final = event.content.parts[0].text or ""
        return final

    try:
        return await asyncio.wait_for(_run(), timeout=timeout)
    except asyncio.TimeoutError as e:
        raise RuntimeError(
            f"LLM agent {agent.name!r} timed out after {timeout:.0f}s (asyncio.wait_for). "
            f"For slow Ollama models raise SURAKSHA_AGENT_LLM_TIMEOUT_SEC in agent-service/.env "
            f"(configured value is {config.AGENT_LLM_TIMEOUT_SEC:.0f}s before the per-agent floor is applied)."
        ) from e


def parse_json(text: str):
    """Best-effort JSON extraction from an LLM response."""
    if not text:
        return None
    cleaned = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    try:
        return json.loads(cleaned)
    except Exception:
        pass
    # Grab the first JSON array/object substring.
    match = re.search(r"(\[.*\]|\{.*\})", cleaned, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except Exception:
            return None
    return None
