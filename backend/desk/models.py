from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Role(models.TextChoices):
        MACHINIST = "machinist", "操作员"
        AUDITOR = "auditor", "复核员"

    role = models.CharField(
        max_length=20,
        choices=Role.choices,
        default=Role.MACHINIST,
    )

    @property
    def can_write(self) -> bool:
        return self.role == self.Role.MACHINIST


class OffsetSubmission(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "待复核"
        PROCESSING = "processing", "复核中"
        DONE = "done", "已完成"

    class Verdict(models.TextChoices):
        PASS = "合格", "合格"
        FAIL = "超差", "超差"

    tool_code = models.CharField(max_length=32, db_index=True)
    offset_um = models.IntegerField()
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    verdict = models.CharField(
        max_length=8,
        choices=Verdict.choices,
        blank=True,
        default="",
    )
    submitted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="submissions",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.tool_code} {self.offset_um}µm"


class OffsetRevision(models.Model):
    """一笔刀补的改数 / 结清履历，旧值、新值与最终结论均可对照。"""

    class Kind(models.TextChoices):
        REVISE = "revise", "改数重投"
        SETTLE = "settle", "结清"

    submission = models.ForeignKey(
        OffsetSubmission,
        on_delete=models.CASCADE,
        related_name="revisions",
    )
    kind = models.CharField(max_length=16, choices=Kind.choices)
    # 改数：改前旧值；结清：本次判定所吃的（改后）数字
    offset_before = models.IntegerField()
    # 改数：改后新值；结清不写
    offset_after = models.IntegerField(null=True, blank=True)
    verdict = models.CharField(
        max_length=8,
        choices=OffsetSubmission.Verdict.choices,
        blank=True,
        default="",
    )
    operator = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="revisions",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self) -> str:
        if self.kind == self.Kind.REVISE:
            return f"改数 {self.offset_before}→{self.offset_after}"
        return f"结清 {self.offset_before} {self.verdict}"
