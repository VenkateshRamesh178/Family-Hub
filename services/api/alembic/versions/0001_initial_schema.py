"""initial schema: users, sessions, families, members, invites, roles, lists

Revision ID: 0001
Revises:
Create Date: 2026-10-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ts = sa.DateTime(timezone=True)


def _item_columns() -> list:
    """Columns from models.FamilyItem."""
    return [
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", ts, nullable=False),
        sa.Column("updated_at", ts, nullable=False),
    ]


def _item_constraints(table: str) -> list:
    return [
        sa.ForeignKeyConstraint(
            ["family_id"], ["families.id"], name=f"fk_{table}_family_id_families", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"], ["users.id"], name=f"fk_{table}_created_by_id_users", ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name=f"pk_{table}"),
    ]


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("display_name", sa.String(80), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("created_at", ts, nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )
    op.create_table(
        "auth_sessions",
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", ts, nullable=False),
        sa.Column("expires_at", ts, nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_auth_sessions_user_id_users", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("token_hash", name="pk_auth_sessions"),
    )
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])
    op.create_table(
        "families",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", ts, nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], name="fk_families_owner_id_users"),
        sa.PrimaryKeyConstraint("id", name="pk_families"),
    )
    op.create_table(
        "memberships",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("role_id", sa.String(80), nullable=False),
        sa.Column("invited_by", sa.String(254), nullable=False),
        sa.Column("invited_at", ts, nullable=False),
        sa.Column("joined_at", ts, nullable=False),
        sa.ForeignKeyConstraint(
            ["family_id"], ["families.id"], name="fk_memberships_family_id_families", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_memberships_user_id_users", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_memberships"),
        sa.UniqueConstraint("user_id", name="uq_memberships_user_id"),
    )
    op.create_index("ix_memberships_family_id", "memberships", ["family_id"])
    op.create_table(
        "invites",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("role_id", sa.String(80), nullable=False),
        sa.Column("invited_by", sa.String(254), nullable=False),
        sa.Column("created_at", ts, nullable=False),
        sa.ForeignKeyConstraint(
            ["family_id"], ["families.id"], name="fk_invites_family_id_families", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_invites"),
        sa.UniqueConstraint("family_id", "email", name="uq_invites_family_id"),
    )
    op.create_index("ix_invites_email", "invites", ["email"])
    op.create_table(
        "custom_roles",
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column("id", sa.String(80), nullable=False),
        sa.Column("name", sa.String(40), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("folders", postgresql.JSONB(), nullable=False),
        sa.ForeignKeyConstraint(
            ["family_id"], ["families.id"], name="fk_custom_roles_family_id_families", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("family_id", "id", name="pk_custom_roles"),
    )

    op.create_table(
        "shopping_items",
        *_item_columns(),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("quantity", sa.Numeric(10, 3), nullable=True),
        sa.Column("unit", sa.String(20), nullable=True),
        sa.Column("checked", sa.Boolean(), nullable=False),
        *_item_constraints("shopping_items"),
    )
    op.create_table(
        "todos",
        *_item_columns(),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("assignee_email", sa.String(254), nullable=True),
        sa.Column("done", sa.Boolean(), nullable=False),
        *_item_constraints("todos"),
    )
    op.create_table(
        "purchased_items",
        *_item_columns(),
        sa.Column("item_name", sa.String(120), nullable=False),
        sa.Column("specifications", sa.Text(), nullable=False),
        sa.Column("purchase_link", sa.Text(), nullable=True),
        sa.Column("bought_date", sa.Date(), nullable=False),
        sa.Column("has_warranty", sa.Boolean(), nullable=False),
        sa.Column("warranty_expiry_date", sa.Date(), nullable=True),
        sa.CheckConstraint(
            "(has_warranty AND warranty_expiry_date IS NOT NULL)"
            " OR (NOT has_warranty AND warranty_expiry_date IS NULL)",
            name="ck_purchased_items_warranty_expiry_matches_flag",
        ),
        *_item_constraints("purchased_items"),
    )
    for table in ("shopping_items", "todos", "purchased_items"):
        op.create_index(f"ix_{table}_family_id", table, ["family_id"])


def downgrade() -> None:
    for table in ("purchased_items", "todos", "shopping_items"):
        op.drop_table(table)
    for table in ("custom_roles", "invites", "memberships", "families", "auth_sessions", "users"):
        op.drop_table(table)
