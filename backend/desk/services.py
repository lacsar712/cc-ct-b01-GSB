from django.conf import settings
from django.db import transaction
from django.utils import timezone

from desk.models import OffsetRevision, OffsetSubmission


class RevisionError(Exception):
    """改数被拒：记录不存在 / 已被认领或已结清 / 数值不合法。"""

    def __init__(self, message: str, code: int = 400):
        super().__init__(message)
        self.message = message
        self.code = code


def evaluate_verdict(offset_um: int) -> str:
    if abs(offset_um) <= settings.OFFSET_TOLERANCE_UM:
        return OffsetSubmission.Verdict.PASS
    return OffsetSubmission.Verdict.FAIL


def _not_editable_message(status: str) -> str:
    if status == OffsetSubmission.Status.PROCESSING:
        return "该行已被领走、进入复核中，改数失败"
    if status == OffsetSubmission.Status.DONE:
        return "该行已结清，不能再改数"
    return "当前状态不能改数"


@transaction.atomic
def revise_pending(submission_id: int, new_offset_um: int, operator) -> OffsetSubmission:
    """对一笔仍在排队（待复核）的刀补改数重投。

    与后台认领共用同一行锁：认领先拿到锁则此处随后读到「复核中」并明确失败；
    此处先拿到锁则 worker 的 skip_locked 认领跳过本行，结清时吃改后新值。
    """
    row = (
        OffsetSubmission.objects.select_for_update()
        .filter(pk=submission_id)
        .first()
    )
    if row is None:
        raise RevisionError("刀补记录不存在", code=404)
    if row.status != OffsetSubmission.Status.PENDING:
        # 撞车结局唯一：认领先成则改数明确失败，绝不留「审中半截」。
        raise RevisionError(_not_editable_message(row.status), code=409)

    old_offset_um = row.offset_um
    if new_offset_um == old_offset_um:
        raise RevisionError("新刀补与当前数值相同，无需重投", code=400)

    row.offset_um = new_offset_um
    row.save(update_fields=["offset_um"])
    OffsetRevision.objects.create(
        submission=row,
        kind=OffsetRevision.Kind.REVISE,
        offset_before=old_offset_um,
        offset_after=new_offset_um,
        operator=operator,
    )
    return row


@transaction.atomic
def apply_verdict(submission_id: int) -> OffsetSubmission:
    """结清：锁行后按最新（改后）数字判定，并写一条结清履历。

    行锁保证结清吃到的是已提交的最新刀补，旧值、新值与最终结论可对照。
    """
    row = OffsetSubmission.objects.select_for_update().get(pk=submission_id)
    if row.status == OffsetSubmission.Status.DONE:
        return row

    settled_offset_um = row.offset_um
    verdict = evaluate_verdict(settled_offset_um)
    row.verdict = verdict
    row.status = OffsetSubmission.Status.DONE
    row.reviewed_at = timezone.now()
    row.save(update_fields=["verdict", "status", "reviewed_at"])
    OffsetRevision.objects.create(
        submission=row,
        kind=OffsetRevision.Kind.SETTLE,
        offset_before=settled_offset_um,
        verdict=verdict,
    )
    return row
