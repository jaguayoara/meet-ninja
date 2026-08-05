"""Validacion de sintaxis de los .py del backend (no requiere deps)."""
import ast
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parent.parent / "python_backend"
ok = 0
fail = 0
for p in sorted(root.glob("*.py")):
    try:
        ast.parse(p.read_text(encoding="utf-8"))
        print(f"OK   {p.name}")
        ok += 1
    except SyntaxError as e:
        print(f"FAIL {p.name}: {e}")
        fail += 1

print(f"\nTotal: {ok} OK, {fail} FAIL")
sys.exit(0 if fail == 0 else 1)
