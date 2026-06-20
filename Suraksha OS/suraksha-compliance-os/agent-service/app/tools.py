"""ADK function tools backed by Supabase (tenant-scoped via a context var)."""
from __future__ import annotations

import contextvars

from . import supabase_client as sb

# Set per agent run so tools know which tenant they operate on.
CURRENT_ORG: contextvars.ContextVar[str | None] = contextvars.ContextVar("current_org", default=None)


def get_departments() -> dict:
    """Return the list of department names for the current bank/organization.

    Use this to assign a Measurable Action Point to a real department that
    exists in the bank.
    """
    org = CURRENT_ORG.get()
    names = sb.list_departments(org) if org else []
    return {"departments": names}


def get_open_map_cards() -> dict:
    """Return the open (not completed) Measurable Action Points for the current bank,
    so completion can be validated against collected evidence.
    """
    org = CURRENT_ORG.get()
    cards = sb.open_map_cards(org) if org else []
    return {"map_cards": cards}
