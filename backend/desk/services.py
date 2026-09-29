from django.conf import settings
from django.db import transaction
from django.utils import timezone

from desk.models import OffsetAmendment, OffsetSubmission


def evaluate_verdict(offset_um: int) -> str:
    if abs(offset_um) <= settings.OFFSET_TOLERANCE_UM:
        return OffsetSubmission.Verdict.PASS
    return OffsetSubmission.Verdict.FAIL


def apply_verdict(submission: OffsetSubmission) -> None:
    # 结论始终吃当前（可能已被重投改写的）刀补值
    submission.verdict = evaluate_verdict(submission.offset_um)
    submission.status = OffsetSubmission.Status.DONE
    submission.reviewed_at = timezone.now()
    submission.save(
        update_fields=["verdict", "status", "reviewed_at"],
    )


class OffsetNotPendingError(Exception):
    """行已被认领（复核中）或已结清，改数必须明确失败。"""

    def __init__(self, current_status: str):
        self.current_status = current_status
        super().__init__(f"刀补记录当前状态为 {current_status}，不可改数重投")


def amend_pending_offset(
    submission: OffsetSubmission,
    new_offset_um: int,
    user,
) -> OffsetAmendment:
    """对未被领走的待复核行改数重投。

    与 worker 的认领互斥靠同一把行锁：
    - worker 认领先成（skip_locked 持锁翻成 processing）：本调用阻塞等锁，
      锁释放后在锁内复查到 processing/done，明确抛 OffsetNotPendingError；
    - 改数先成：本事务持锁期间 worker 的 skip_locked 直接跳过该行，
      提交后 worker 下一轮领到的就是新值，不可能在复核半截被改。
    """
    with transaction.atomic():
        locked = OffsetSubmission.objects.select_for_update().get(pk=submission.pk)
        if locked.status != OffsetSubmission.Status.PENDING:
            raise OffsetNotPendingError(locked.status)

        old_offset_um = locked.offset_um
        locked.offset_um = new_offset_um
        locked.save(update_fields=["offset_um"])

        amendment = OffsetAmendment.objects.create(
            submission=locked,
            old_offset_um=old_offset_um,
            new_offset_um=new_offset_um,
            changed_by=user,
        )
        # 把新值带回调用方，避免它手里还是旧对象
        submission.offset_um = new_offset_um
        return amendment
