"""Scoped authorization primitives; domain modules/AI dispatcher integrate separately."""
from .models import Target
from .store import PolicyStore

__all__ = ['Target', 'PolicyStore']
