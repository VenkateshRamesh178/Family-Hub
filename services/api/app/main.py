from fastapi import APIRouter, FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .routers import auth, calendar, docs, family, lists, members


def _readable(err: dict) -> str:
    field = next((str(p) for p in reversed(err.get("loc", ())) if isinstance(p, str) and p != "body"), None)
    msg = str(err.get("msg", "Invalid value")).removeprefix("Value error, ")
    return f"{field}: {msg}" if field else msg


def create_app() -> FastAPI:
    app = FastAPI(title="Family Hub API", version="0.0.0")

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        """`detail` is one readable sentence for the UI; `errors` keeps FastAPI's full list."""
        errors = list(exc.errors())
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={
                "detail": _readable(errors[0]) if errors else "Invalid request",
                "errors": jsonable_encoder(errors, custom_encoder={Exception: str}),
            },
        )

    api = APIRouter(prefix="/api")

    @api.get("/health", tags=["meta"])
    async def health() -> dict:
        return {"ok": True}

    routers = (
        auth.router,
        family.router,
        members.router,
        lists.shopping,
        lists.todos,
        lists.purchases,
        calendar.events,
        calendar.router,
        docs.router,
    )
    for r in routers:
        api.include_router(r)
    app.include_router(api)
    return app


app = create_app()
