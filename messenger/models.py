from django.db import models
from django.contrib.auth.models import User

class Profile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    chave_publica_ecdh = models.TextField(blank=True)
    chave_registrada_em = models.DateTimeField(null=True)
    fingerprint_verificado = models.BooleanField(default=False)