from datetime import datetime
from typing import Optional

from django.http import HttpRequest
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from desk.auth_utils import bearer_auth, create_access_token, verify_password
from desk.models import OffsetAmendment, OffsetSubmission, User
from desk.services import OffsetNotPendingError, amend_pending_offset

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


class AmendIn(Schema):
    offset_um: int


class AmendmentOut(Schema):
    id: int
    old_offset_um: int
    new_offset_um: int
    changed_by: Optional[str]
    created_at: datetime


class SubmissionOut(Schema):
    id: int
    tool_code: str
    offset_um: int
    status: str
    verdict: str
    created_at: datetime
    reviewed_at: Optional[datetime]
    amendments: list[AmendmentOut] = []


def _amendment_out(row: OffsetAmendment) -> AmendmentOut:
    return AmendmentOut(
        id=row.id,
        old_offset_um=row.old_offset_um,
        new_offset_um=row.new_offset_um,
        changed_by=row.changed_by.username if row.changed_by else None,
        created_at=row.created_at,
    )


def _to_out(row: OffsetSubmission, amendments=None) -> SubmissionOut:
    if amendments is None:
        amendments = row.amendments.all()
    return SubmissionOut(
        id=row.id,
        tool_code=row.tool_code,
        offset_um=row.offset_um,
        status=row.status,
        verdict=row.verdict or "",
        created_at=row.created_at,
        reviewed_at=row.reviewed_at,
        amendments=[_amendment_out(a) for a in amendments],
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
    rows = OffsetSubmission.objects.prefetch_related(
        "amendments__changed_by"
    ).all()[:200]
    return [_to_out(r) for r in rows]


@api.get("/submissions/{submission_id}", response=SubmissionOut, auth=bearer_auth)
def get_submission(request: HttpRequest, submission_id: int):
    try:
        row = (
            OffsetSubmission.objects.prefetch_related("amendments__changed_by")
            .get(pk=submission_id)
        )
    except OffsetSubmission.DoesNotExist:
        raise HttpError(404, "刀补记录不存在")
    return _to_out(row)


@api.get(
    "/submissions/{submission_id}/amendments",
    response=list[AmendmentOut],
    auth=bearer_auth,
)
def list_amendments(request: HttpRequest, submission_id: int):
    try:
        OffsetSubmission.objects.get(pk=submission_id)
    except OffsetSubmission.DoesNotExist:
        raise HttpError(404, "刀补记录不存在")
    rows = OffsetAmendment.objects.filter(submission_id=submission_id).select_related(
        "changed_by"
    )
    return [_amendment_out(r) for r in rows]


@api.post(
    "/submissions/{submission_id}/amend",
    response=SubmissionOut,
    auth=bearer_auth,
)
def amend_submission(request: HttpRequest, submission_id: int, body: AmendIn):
    user: User = request.auth
    if not user.can_write:
        raise HttpError(403, "当前账号只读，不能改数重投")
    try:
        row = OffsetSubmission.objects.get(pk=submission_id)
    except OffsetSubmission.DoesNotExist:
        raise HttpError(404, "刀补记录不存在")
    try:
        amend_pending_offset(row, body.offset_um, user)
    except OffsetNotPendingError as exc:
        # 已被领走（复核中）或已结清：改数必须明确失败
        raise HttpError(409, f"改数失败：{exc}")
    row = (
        OffsetSubmission.objects.prefetch_related("amendments__changed_by")
        .get(pk=submission_id)
    )
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
