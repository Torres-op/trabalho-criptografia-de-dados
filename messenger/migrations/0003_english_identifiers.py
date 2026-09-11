import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def forwards_direction(apps, schema_editor):
    Message = apps.get_model("messenger", "Message")
    Message.objects.filter(direction="enviada").update(direction="sent")
    Message.objects.filter(direction="recebida").update(direction="received")


def backwards_direction(apps, schema_editor):
    Message = apps.get_model("messenger", "Message")
    Message.objects.filter(direction="sent").update(direction="enviada")
    Message.objects.filter(direction="received").update(direction="recebida")


class Migration(migrations.Migration):

    dependencies = [
        ("messenger", "0002_mensagem"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RemoveIndex(model_name="mensagem", name="messenger_m_destina_55da45_idx"),
        migrations.RenameModel(old_name="Mensagem", new_name="Message"),
        migrations.RenameField(model_name="message", old_name="remetente", new_name="sender"),
        migrations.RenameField(model_name="message", old_name="destinatario", new_name="recipient"),
        migrations.RenameField(model_name="message", old_name="criado_em", new_name="created_at"),
        migrations.RenameField(model_name="message", old_name="recebido_em", new_name="received_at"),
        migrations.RenameField(model_name="message", old_name="origem", new_name="direction"),
        migrations.RenameField(
            model_name="profile", old_name="chave_publica_ecdh", new_name="ecdh_public_key"
        ),
        migrations.RenameField(
            model_name="profile", old_name="chave_registrada_em", new_name="key_registered_at"
        ),
        migrations.RenameField(
            model_name="profile", old_name="fingerprint_verificado", new_name="fingerprint_verified"
        ),
        migrations.RunPython(forwards_direction, backwards_direction),
        migrations.AlterModelOptions(
            name="message",
            options={
                "ordering": ["-received_at"],
                "verbose_name": "mensagem",
                "verbose_name_plural": "mensagens",
            },
        ),
        migrations.AlterModelOptions(
            name="profile",
            options={"verbose_name": "perfil", "verbose_name_plural": "perfis"},
        ),
        migrations.AlterField(
            model_name="message",
            name="blob",
            field=models.BinaryField(verbose_name="conteúdo cifrado"),
        ),
        migrations.AlterField(
            model_name="message",
            name="created_at",
            field=models.DateTimeField(verbose_name="escrita em"),
        ),
        migrations.AlterField(
            model_name="message",
            name="direction",
            field=models.CharField(
                choices=[("sent", "Enviada"), ("received", "Recebida")],
                max_length=10,
                verbose_name="origem",
            ),
        ),
        migrations.AlterField(
            model_name="message",
            name="received_at",
            field=models.DateTimeField(auto_now_add=True, verbose_name="recebida em"),
        ),
        migrations.AlterField(
            model_name="message",
            name="recipient",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="received_messages",
                to=settings.AUTH_USER_MODEL,
                verbose_name="destinatário",
            ),
        ),
        migrations.AlterField(
            model_name="message",
            name="sender",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="sent_messages",
                to=settings.AUTH_USER_MODEL,
                verbose_name="remetente",
            ),
        ),
        migrations.AlterField(
            model_name="profile",
            name="ecdh_public_key",
            field=models.TextField(blank=True, verbose_name="chave pública ECDH"),
        ),
        migrations.AlterField(
            model_name="profile",
            name="fingerprint_verified",
            field=models.BooleanField(default=False, verbose_name="fingerprint verificado"),
        ),
        migrations.AlterField(
            model_name="profile",
            name="key_registered_at",
            field=models.DateTimeField(blank=True, null=True, verbose_name="chave registrada em"),
        ),
        migrations.AlterField(
            model_name="profile",
            name="user",
            field=models.OneToOneField(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="profile",
                to=settings.AUTH_USER_MODEL,
                verbose_name="usuário",
            ),
        ),
        migrations.AddIndex(
            model_name="message",
            index=models.Index(fields=["recipient", "-received_at"], name="message_recipient_idx"),
        ),
    ]
