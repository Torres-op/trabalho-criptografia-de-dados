from django.db import models
from django.contrib.auth.models import User

class Profile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    chave_publica_ecdh = models.TextField(blank=True)
    chave_registrada_em = models.DateTimeField(null=True)
    fingerprint_verificado = models.BooleanField(default=False)

class Message(models.Model):
    DIRECTION_CHOICES = [
        ('sent', 'Enviada'),
        ('received', 'Recebida')
    ]
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name="sent")
    recipient = models.ForeignKey(User, on_delete=models.CASCADE, related_name="received")
    blob = models.BinaryField()
    created_at = models.DateTimeField()
    received_at = models.DateTimeField(auto_now_add=True)
    direction = models.CharField(max_length=10, choices=DIRECTION_CHOICES)

    class Meta:
        indexes = [
            models.Index(fields=['recipient', '-received_at']),
        ]