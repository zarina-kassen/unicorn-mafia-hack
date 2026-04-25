from fastapi import FastAPI

app = FastAPI(title="unicorn-mafia-hack-backend")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
