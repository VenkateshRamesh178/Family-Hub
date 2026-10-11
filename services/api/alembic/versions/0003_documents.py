"""documents: folders, file versions, trash, and the document audit log

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ts = sa.DateTime(timezone=True)


def _item_columns() -> list[sa.Column]:
    return [
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", ts, nullable=False),
        sa.Column("updated_at", ts, nullable=False),
    ]


def _item_constraints(table: str) -> list[sa.Constraint]:
    return [
        sa.ForeignKeyConstraint(["family_id"], ["families.id"], name=f"fk_{table}_family_id_families", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], name=f"fk_{table}_created_by_id_users", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name=f"pk_{table}"),
    ]


def upgrade() -> None:
    op.create_table(
        "doc_folders",
        *_item_columns(),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(
            ["parent_id"], ["doc_folders.id"], name="fk_doc_folders_parent_id_doc_folders", ondelete="CASCADE"
        ),
        *_item_constraints("doc_folders"),
    )
    op.create_index("ix_doc_folders_family_id", "doc_folders", ["family_id"])

    # documents.current_version_id and document_versions.document_id point at each other,
    # so the first of those foreign keys is added once both tables exist.
    op.create_table(
        "documents",
        *_item_columns(),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("folder_id", sa.Uuid(), nullable=True),
        sa.Column("expiry_date", sa.Date(), nullable=True),
        sa.Column("purchase_id", sa.Uuid(), nullable=True),
        sa.Column("current_version_id", sa.Uuid(), nullable=True),
        sa.Column("deleted_at", ts, nullable=True),
        sa.ForeignKeyConstraint(
            ["folder_id"], ["doc_folders.id"], name="fk_documents_folder_id_doc_folders", ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["purchase_id"], ["purchased_items.id"], name="fk_documents_purchase_id_purchased_items", ondelete="SET NULL"
        ),
        *_item_constraints("documents"),
    )
    for column in ("family_id", "folder_id", "purchase_id"):
        op.create_index(f"ix_documents_{column}", "documents", [column])

    op.create_table(
        "document_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=True),
        sa.Column("storage_key", sa.String(200), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(127), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("pending", sa.Boolean(), nullable=False),
        sa.Column("uploaded_by_id", sa.Uuid(), nullable=True),
        sa.Column("uploaded_at", ts, nullable=False),
        sa.CheckConstraint("pending OR document_id IS NOT NULL", name="ck_document_versions_ready_has_document"),
        sa.ForeignKeyConstraint(
            ["family_id"], ["families.id"], name="fk_document_versions_family_id_families", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["document_id"], ["documents.id"], name="fk_document_versions_document_id_documents", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["uploaded_by_id"], ["users.id"], name="fk_document_versions_uploaded_by_id_users", ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_document_versions"),
        sa.UniqueConstraint("storage_key", name="uq_document_versions_storage_key"),
    )
    op.create_index("ix_document_versions_family_id", "document_versions", ["family_id"])
    op.create_index("ix_document_versions_document_id", "document_versions", ["document_id"])
    op.create_foreign_key(
        "fk_documents_current_version_id_document_versions",
        "documents",
        "document_versions",
        ["current_version_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_table(
        "doc_audit_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=True),
        sa.Column("document_title", sa.String(200), nullable=False),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("actor_email", sa.String(254), nullable=False),
        sa.Column("detail", sa.String(300), nullable=False),
        sa.Column("at", ts, nullable=False),
        sa.ForeignKeyConstraint(
            ["family_id"], ["families.id"], name="fk_doc_audit_events_family_id_families", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["document_id"], ["documents.id"], name="fk_doc_audit_events_document_id_documents", ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_doc_audit_events"),
    )
    op.create_index("ix_doc_audit_events_family_id", "doc_audit_events", ["family_id"])
    op.create_index("ix_doc_audit_events_document_id", "doc_audit_events", ["document_id"])


def downgrade() -> None:
    op.drop_table("doc_audit_events")
    op.drop_constraint("fk_documents_current_version_id_document_versions", "documents", type_="foreignkey")
    op.drop_table("document_versions")
    op.drop_table("documents")
    op.drop_table("doc_folders")
