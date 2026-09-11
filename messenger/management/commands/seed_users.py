import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from messenger.models import Profile

USERNAME_1 = "usuario1"
USERNAME_2 = "usuario2"


class Command(BaseCommand):
    help = "Cria os 2 usuarios fixos do sistema e seus perfis, de forma idempotente."

    def handle(self, *args, **options):
        password_1 = os.environ.get("USER1_PASSWORD")
        password_2 = os.environ.get("USER2_PASSWORD")

        missing = [
            name
            for name, value in (("USER1_PASSWORD", password_1), ("USER2_PASSWORD", password_2))
            if not value
        ]
        if missing:
            raise CommandError(
                "Variavel(is) de ambiente ausente(s): "
                f"{', '.join(missing)}. Defina-as no .env antes de rodar este comando."
            )

        with transaction.atomic():
            self._seed_user(USERNAME_1, password_1)
            self._seed_user(USERNAME_2, password_2)

    def _seed_user(self, username, password):
        User = get_user_model()
        user, created = User.objects.get_or_create(username=username)

        if created:
            user.set_password(password)
            user.save()
            self.stdout.write(self.style.SUCCESS(f"Usuario '{username}' criado."))
        else:
            self.stdout.write(f"Usuario '{username}' ja existia — nenhuma alteracao feita.")

        Profile.objects.get_or_create(user=user)