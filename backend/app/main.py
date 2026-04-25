from fastapi import FastAPI

app = FastAPI(title="frame-mog")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
