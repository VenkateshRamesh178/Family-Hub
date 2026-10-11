"""Shopping list, to-dos and items purchased. Every member can read; writing needs `lists:write`.

Concurrent edits are last-write-wins per item (plan §6)."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import Db, Member, require
from ..models import Membership, PurchasedItem, ShoppingItem, Todo, User
from ..schemas import (
    PurchasedItemIn,
    PurchasedItemOut,
    PurchasedItemPatch,
    ShoppingItemIn,
    ShoppingItemOut,
    ShoppingItemPatch,
    TodoIn,
    TodoOut,
    TodoPatch,
)
from .crud import add_crud_routes

Writer = Annotated[Member, Depends(require("lists", "write"))]

# --- Shopping -------------------------------------------------------------------

shopping = APIRouter(prefix="/shopping", tags=["shopping"])


@shopping.delete("/checked", status_code=status.HTTP_204_NO_CONTENT)
async def clear_checked(member: Writer, db: Db) -> None:
    """Remove everything that's been ticked off."""
    await db.execute(
        delete(ShoppingItem).where(ShoppingItem.family_id == member.family.id, ShoppingItem.checked.is_(True))
    )
    await db.commit()


add_crud_routes(
    shopping,
    ShoppingItem,
    ShoppingItemIn,
    ShoppingItemPatch,
    ShoppingItemOut,
    [ShoppingItem.checked, ShoppingItem.created_at],
)

# --- To-dos ---------------------------------------------------------------------

todos = APIRouter(prefix="/todos", tags=["todos"])


async def _check_assignee(db: AsyncSession, member: Member, data: TodoIn) -> None:
    if data.assignee_email is None:
        return
    found = await db.scalar(
        select(Membership.id)
        .join(User, Membership.user_id == User.id)
        .where(Membership.family_id == member.family.id, User.email == data.assignee_email)
    )
    if not found:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"{data.assignee_email} isn't in this family.")


add_crud_routes(
    todos,
    Todo,
    TodoIn,
    TodoPatch,
    TodoOut,
    [Todo.done, Todo.due_date.asc().nulls_last(), Todo.created_at],
    check=_check_assignee,
)

# --- Items purchased ----------------------------------------------------------------

purchases = APIRouter(prefix="/purchases", tags=["purchases"])

add_crud_routes(
    purchases,
    PurchasedItem,
    PurchasedItemIn,
    PurchasedItemPatch,
    PurchasedItemOut,
    [PurchasedItem.bought_date.desc(), PurchasedItem.created_at.desc()],
)
