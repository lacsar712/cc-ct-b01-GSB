"""Background worker: claim pending rows with SKIP LOCKED and apply verdict."""

import os
import sys
import time
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import django


def setup_django() -> None:
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    django.setup()


def claim_one_pending():
    from django.db import transaction

    from desk.models import OffsetSubmission
    from desk.services import apply_verdict

    submission_id = None
    with transaction.atomic():
        submission = (
            OffsetSubmission.objects.select_for_update(skip_locked=True)
            .filter(status=OffsetSubmission.Status.PENDING)
            .order_by("created_at", "id")
            .first()
        )
        if submission is None:
            return False

        submission.status = OffsetSubmission.Status.PROCESSING
        submission.save(update_fields=["status"])
        submission_id = submission.id

    # 认领与结清分属两个事务：结清时重新锁行，确保吃到改数重投后的最新数字。
    # 已被认领的行状态为「复核中」，改数接口会明确拒绝，二者互斥只有一种结局。
    apply_verdict(submission_id)
    return True


def run_loop(poll_seconds: float = 0.5) -> None:
    setup_django()
    print("cnc-offset worker started", flush=True)
    while True:
        claimed = claim_one_pending()
        if not claimed:
            time.sleep(poll_seconds)


if __name__ == "__main__":
    setup_django()
    if len(sys.argv) > 1 and sys.argv[1] == "once":
        claim_one_pending()
    else:
        run_loop()
