from django.db import models
from django.contrib.auth.models import User

class Profile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    chave_publica_ecdh = models.TextField(blank=True)
    chave_registrada_em = models.DateTimeField(null=True)
    fingerprint_verificado = models.BooleanField(default=False)

class Mensagem(models.Model):
    ORIGEM_CHOICES = [
        ('enviada', 'Enviada'),
        ('recebida', 'Recebida')
    ]
    remetente = models.ForeignKey(User, on_delete=models.CASCADE, related_name="enviadas")
    destinatario = models.ForeignKey(User, on_delete=models.CASCADE, related_name="recebidas")
    blob = models.BinaryField()
    criado_em = models.DateTimeField()
    recebido_em = models.DateTimeField(auto_now_add=True)
    origem = models.CharField(max_length=10, choices=ORIGEM_CHOICES)
    
    class Meta:
            indexes = [
                models.Index(fields=['destinatario', '-recebido_em']),
            ]