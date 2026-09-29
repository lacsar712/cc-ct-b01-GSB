from datetime import datetime
from typing import Optional

from django.http import HttpRequest
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from desk.auth_utils import bearer_auth, create_access_token, verify_password
from desk.models import OffsetRevision, OffsetSubmission, User
from desk.services import RevisionError, revise_pending

api = NinjaAPI(title="数控刀补复核台", version="1.0")


class HealthOut(Schema):
    status: str


class LoginIn(Schema):
    username: str
    password: str


class LoginOut(Schema):
    token: str
    username: str
    role: str
    can_write: bool


class SubmissionIn(Schema):
    tool_code: str
    offset_um: int


class RevisionOut(Schema):
    id: int
    kind: str
    kind_label: str
    offset_before: int
    offset_after: Optional[int]
    verdict: str
    operator: Optional[str]
    created_at: datetime


class SubmissionOut(Schema):
    id: int
    tool_code: str
    offset_um: int
    status: str
    verdict: str
    created_at: datetime
    reviewed_at: Optional[datetime]
    revisions: list[RevisionOut] = []


class ReworkIn(Schema):
    offset_um: int


def _revision_to_out(row: OffsetRevision) -> RevisionOut:
    return RevisionOut(
        id=row.id,
        kind=row.kind,
        kind_label=row.get_kind_display(),
        offset_before=row.offset_before,
        offset_after=row.offset_after,
        verdict=row.verdict or "",
        operator=row.operator.username if row.operator_id else None,
        created_at=row.created_at,
    )


def _to_out(row: OffsetSubmission) -> SubmissionOut:
    return SubmissionOut(
        id=row.id,
        tool_code=row.tool_code,
        offset_um=row.offset_um,
        status=row.status,
        verdict=row.verdict or "",
        created_at=row.created_at,
        reviewed_at=row.reviewed_at,
        revisions=[_revision_to_out(r) for r in row.revisions.all()],
    )


@api.get("/health", response=HealthOut)
def health(request: HttpRequest):
    return {"status": "ok"}


@api.post("/auth/login", response=LoginOut)
def login(request: HttpRequest, body: LoginIn):
    try:
        user = User.objects.get(username=body.username)
    except User.DoesNotExist:
        raise HttpError(401, "用户名或密码错误")
    if not verify_password(body.password, user.password):
        raise HttpError(401, "用户名或密码错误")
    token = create_access_token(user)
    return {
        "token": token,
        "username": user.username,
        "role": user.role,
        "can_write": user.can_write,
    }


@api.get("/submissions", response=list[SubmissionOut], auth=bearer_auth)
def list_submissions(request: HttpRequest):
    rows = OffsetSubmission.objects.prefetch_related("revisions", "revisions__operator")[:200]
    return [_to_out(r) for r in rows]


@api.get("/submissions/{submission_id}", response=SubmissionOut, auth=bearer_auth)
def get_submission(request: HttpRequest, submission_id: int):
    row = (
        OffsetSubmission.objects.prefetch_related("revisions", "revisions__operator")
        .filter(pk=submission_id)
        .first()
    )
    if row is None:
        raise HttpError(404, "刀补记录不存在")
    return _to_out(row)


@api.post("/submissions", response=SubmissionOut, auth=bearer_auth)
def create_submission(request: HttpRequest, body: SubmissionIn):
    user: User = request.auth
    if not user.can_write:
        raise HttpError(403, "当前账号只读，不能提交刀补")
    tool_code = body.tool_code.strip()
    if not tool_code:
        raise HttpError(400, "刀具编号不能为空")
    row = OffsetSubmission.objects.create(
        tool_code=tool_code,
        offset_um=body.offset_um,
        submitted_by=user,
        status=OffsetSubmission.Status.PENDING,
    )
    return _to_out(row)


@api.post("/submissions/{submission_id}/revise", response=SubmissionOut, auth=bearer_auth)
def revise_submission(request: HttpRequest, submission_id: int, body: ReworkIn):
    user: User = request.auth
    if not user.can_write:
        raise HttpError(403, "当前账号只读，不能改数重投")
    try:
        row = revise_pending(submission_id, body.offset_um, operator=user)
    except RevisionError as exc:
        raise HttpError(exc.code, exc.message)
    # 重新取一遍带履历的数据返回
    row = (
        OffsetSubmission.objects.prefetch_related("revisions", "revisions__operator")
        .get(pk=row.pk)
    )
    return _to_out(row)
