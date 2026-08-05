"""Test del endpoint /chat."""
import json
import urllib.request

BASE = "http://127.0.0.1:8765"

TRANSCRIPT = """Hola equipo, el viernes 15 hay que entregar el informe. Maria se encarga de la seccion 2, yo de la conclusion. El lunes 18 tenemos otra reunion. Juan propuso cambiar el formato del informe. No hay presupuesto extra para impresiones."""


def chat(question: str, history=None):
    payload = {"transcript": TRANSCRIPT, "question": question, "history": history or []}
    req = urllib.request.Request(
        f"{BASE}/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    print("[1] ¿Quien se encarga de la seccion 2?")
    r = chat("¿Quien se encarga de la seccion 2?")
    print(f"    -> {r['answer']}\n")

    print("[2] ¿Cuando es la proxima reunion y que se decidio sobre el formato?")
    r = chat("¿Cuando es la proxima reunion y que se decidio sobre el formato?")
    print(f"    -> {r['answer']}\n")

    print("[3] ¿Cual es la capital de Francia? (fuera de contexto)")
    r = chat("¿Cual es la capital de Francia?")
    print(f"    -> {r['answer']}\n")

    print("[4] Multi-turn: pregunta + seguimiento")
    history = []
    q1 = "¿Quien propuso cambiar el formato?"
    r1 = chat(q1)
    print(f"    P1: {q1}")
    print(f"    -> {r1['answer']}")
    history.append({"role": "user", "content": q1})
    history.append({"role": "assistant", "content": r1["answer"]})
    q2 = "¿Y por que queria cambiarlo?"
    r2 = chat(q2, history=history)
    print(f"    P2: {q2}")
    print(f"    -> {r2['answer']}")


if __name__ == "__main__":
    main()
