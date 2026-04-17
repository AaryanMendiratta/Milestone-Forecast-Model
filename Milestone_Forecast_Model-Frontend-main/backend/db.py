"""
db.py — Supabase client singleton for the backend.

Requires environment variables:
  SUPABASE_URL         — your project URL (e.g. https://xyz.supabase.co)
  SUPABASE_SERVICE_KEY — service-role secret key (bypasses RLS, for writes)
"""

import os
from supabase import create_client, Client

_client: Client | None = None


def get_client() -> Client:
    """Return the cached Supabase client, creating it on first call."""
    global _client
    if _client is None:
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_KEY")
        if not url or not key:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables must be set "
                "to use database-backed Monte Carlo simulation."
            )
        _client = create_client(url, key)
    return _client
