# This file is kept for backward compatibility.
# Now lives inside the backend/ package itself.
#
# ✅ Run the server from the project root with:P
#
#     uvicorn backend.main:app --reload
#
# All endpoints (save, load, calculate) are defined in backend/main.py

try:
    from .main import app  # relative import — works correctly inside the package
except ImportError:
    from main import app  # fallback for direct execution

__all__ = ["app"]
