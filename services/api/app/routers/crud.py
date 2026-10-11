"""Generic list/create/patch/delete routes for family-owned items."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import Db, Member, require
from ..roles import Resource


def add_crud_routes(
    router: APIRouter,
    model: type,
    in_schema: type[BaseModel],
    patch_schema: type[BaseModel],
    out_schema: type[BaseModel],
    order_by: list[Any],
    check: Any = None,
    resource: Resource = "lists",
) -> None:
    """list / create / patch / delete for one family-scoped item type.

    Every member can list; changing needs `resource:write`.
    `check(db, member, data)` may raise to reject a create or update.
    """
    Reader = Annotated[Member, Depends(require(resource, "read"))]
    Writer = Annotated[Member, Depends(require(resource, "write"))]

    async def get_item(db: AsyncSession, member: Member, item_id: uuid.UUID):
        item = await db.get(model, item_id)
        if item is None or item.family_id != member.family.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found.")
        return item

    @router.get("", response_model=list[out_schema])
    async def list_items(member: Reader, db: Db):
        return (await db.scalars(select(model).where(model.family_id == member.family.id).order_by(*order_by))).all()

    @router.post("", response_model=out_schema, status_code=status.HTTP_201_CREATED)
    async def create_item(body: in_schema, member: Writer, db: Db):  # type: ignore[valid-type]
        if check:
            await check(db, member, body)
        item = model(**body.model_dump(by_alias=False), family_id=member.family.id, created_by_id=member.user.id, created_by=member.user)
        db.add(item)
        await db.commit()
        return item

    @router.patch("/{item_id}", response_model=out_schema)
    async def update_item(item_id: uuid.UUID, body: patch_schema, member: Writer, db: Db):  # type: ignore[valid-type]
        item = await get_item(db, member, item_id)
        current = in_schema.model_validate(item, from_attributes=True).model_dump(by_alias=False)
        # Validate the merged result, so cross-field rules (e.g. warranty dates) still hold.
        try:
            data = in_schema.model_validate({**current, **body.model_dump(by_alias=False, exclude_unset=True)})
        except ValidationError as e:
            raise RequestValidationError(e.errors(include_url=False)) from e
        if check:
            await check(db, member, data)
        for key, value in data.model_dump(by_alias=False).items():
            setattr(item, key, value)
        await db.commit()
        return item

    @router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_item(item_id: uuid.UUID, member: Writer, db: Db) -> None:
        await db.delete(await get_item(db, member, item_id))
        await db.commit()
