from decouple import config
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from messenger.models import Profile
from messenger.participants import PARTICIPANT_COUNT, participants

SLOTS = ("A", "B")


class Command(BaseCommand):
    help = "Cria os 2 usuários fixos do sistema e seus perfis, de forma idempotente."

    def handle(self, *args, **options):
        accounts = [self._read_account(slot) for slot in SLOTS]
        usernames = [username for username, _ in accounts]
        if usernames[0] == usernames[1]:
            raise CommandError("SEED_USER_A e SEED_USER_B precisam ser diferentes.")

        with transaction.atomic():
            for username, password in accounts:
                self._seed_user(username, password)

        present = [user.get_username() for user in participants()]
        if len(present) != PARTICIPANT_COUNT:
            self.stdout.write(
                self.style.WARNING(
                    f"Há {len(present)} participantes cadastrados ({', '.join(present)}), "
                    f"mas o sistema exige exatamente {PARTICIPANT_COUNT}. Remova os perfis "
                    "que sobraram pelo /admin/."
                )
            )

    def _read_account(self, slot):
        username_key = f"SEED_USER_{slot}"
        password_key = f"SEED_PASS_{slot}"
        username = config(username_key, default="").strip()
        password = config(password_key, default="")

        missing = [key for key, value in ((username_key, username), (password_key, password)) if not value]
        if missing:
            raise CommandError(
                f"Variável(is) de ambiente ausente(s): {', '.join(missing)}. "
                "Defina-as no .env antes de rodar este comando."
            )
        return username, password

    def _seed_user(self, username, password):
        user, created = get_user_model().objects.get_or_create(username=username)

        if created:
            user.set_password(password)
            user.save(update_fields=["password"])
            self.stdout.write(self.style.SUCCESS(f"Usuário '{username}' criado."))
        else:
            self.stdout.write(f"Usuário '{username}' já existia — senha mantida.")

        Profile.objects.get_or_create(user=user)
