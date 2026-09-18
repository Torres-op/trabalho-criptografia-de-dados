import hashlib

from django.conf import settings
from django.db import models


class Profile(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="profile",
        verbose_name="usuário",
    )
    ecdh_public_key = models.TextField("chave pública ECDH", blank=True)
    key_registered_at = models.DateTimeField("chave registrada em", null=True, blank=True)
    fingerprint_verified = models.BooleanField("fingerprint verificado", default=False)

    class Meta:
        verbose_name = "perfil"
        verbose_name_plural = "perfis"

    def __str__(self):
        return self.user.get_username()

    @property
    def has_public_key(self):
        return bool(self.ecdh_public_key)


class MessageQuerySet(models.QuerySet):
    def owned_by(self, user):
        return self.filter(
            models.Q(direction=Message.Direction.SENT, sender=user)
            | models.Q(direction=Message.Direction.RECEIVED, recipient=user)
        )


class Message(models.Model):
    class Direction(models.TextChoices):
        SENT = "sent", "Enviada"
        RECEIVED = "received", "Recebida"

    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="sent_messages",
        verbose_name="remetente",
    )
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="received_messages",
        verbose_name="destinatário",
    )
    blob = models.BinaryField("conteúdo cifrado")
    created_at = models.DateTimeField("escrita em")
    received_at = models.DateTimeField("recebida em", auto_now_add=True)
    direction = models.CharField("origem", max_length=10, choices=Direction.choices)
    blob_sha256 = models.CharField(
        "hash do conteúdo", max_length=64, default="", editable=False, db_index=True
    )

    objects = MessageQuerySet.as_manager()

    class Meta:
        ordering = ["-received_at"]
        verbose_name = "mensagem"
        verbose_name_plural = "mensagens"
        indexes = [
            models.Index(fields=["recipient", "-received_at"], name="message_recipient_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["sender", "recipient", "direction", "blob_sha256"],
                name="message_unique_copy",
            ),
        ]

    def save(self, *args, **kwargs):
        self.blob_sha256 = hashlib.sha256(bytes(self.blob)).hexdigest()
        return super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.sender} → {self.recipient} ({self.created_at:%d/%m/%Y %H:%M})"


class KeyBackup(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="key_backups",
        verbose_name="usuário",
    )
    blob = models.BinaryField("chave privada cifrada")
    created_at = models.DateTimeField("criado em", auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "backup de chave"
        verbose_name_plural = "backups de chave"

    def __str__(self):
        return f"{self.user} ({self.created_at:%d/%m/%Y %H:%M})"
