from pydantic import BaseModel


class ProvidersOut(BaseModel):
    providers: list[str]
