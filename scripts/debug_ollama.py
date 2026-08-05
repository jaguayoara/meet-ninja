"""Debug especifico: probar cada modelo instalado directamente."""
import asyncio
import logging
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

from summarizer import _ollama_generate_with_model, _ollama_list_models, _is_generative_model


async def main():
    installed = await _ollama_list_models()
    print("Instalados:", installed)
    installed_gen = [m for m in installed if _is_generative_model(m)]
    print("Generativos:", installed_gen)
    print()
    for m in installed_gen:
        print(f"--- Probando modelo {m!r} ---")
        out = await _ollama_generate_with_model(
            "Di OK en una palabra, sin explicaciones.",
            m,
        )
        print(f"  resultado: {out!r}")
        print()


asyncio.run(main())
