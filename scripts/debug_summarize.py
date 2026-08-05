"""Debug: ver que pasa con ollama cuando se llama desde summarize."""
import asyncio
import logging
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

from summarizer import _ollama_generate, summarize, _ollama_list_models, _is_generative_model


async def main():
    installed = await _ollama_list_models()
    print("Instalados:", installed)
    installed_gen = [m for m in installed if _is_generative_model(m)]
    print("Generativos:", installed_gen)

    resp, model = await _ollama_generate("Di OK en una palabra.")
    print("resp:", repr(resp)[:200])
    print("modelo:", model)

    if resp is None:
        print("ollama no respondio, probando resumen extractivo...")
    r = await summarize(
        "Hola equipo, el viernes 15 hay que entregar el informe. Maria hace la seccion 2, yo la conclusion.",
        "reunion",
    )
    print("metodo:", r.get("_metodo"))
    print("modelo:", r.get("_modelo"))
    print("asistentes:", r.get("asistentes"))
    print("tareas:", r.get("tareas"))


asyncio.run(main())
