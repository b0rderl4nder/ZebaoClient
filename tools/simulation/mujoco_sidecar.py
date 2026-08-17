"""Frozen entry point for the desktop-only Reachy Mini MuJoCo daemon."""

import sys

try:
    import mujoco  # noqa: F401
except Exception as exc:  # pragma: no cover - exercised by the frozen artifact
    print(
        f"MuJoCo runtime import failed: {type(exc).__name__}: {exc}",
        file=sys.stderr,
        flush=True,
    )
    raise

from reachy_mini.daemon.app.main import main


if __name__ == "__main__":
    main()
