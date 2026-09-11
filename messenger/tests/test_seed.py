from io import StringIO
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from messenger.models import Profile

from .factories import make_participant

ENV = {
    "SEED_USER_A": "diretor",
    "SEED_PASS_A": "senha-do-diretor-123",
    "SEED_USER_B": "marcio",
    "SEED_PASS_B": "senha-do-marcio-123",
}


def run_seed(values):
    def fake_config(key, default=""):
        return values.get(key, default)

    output = StringIO()
    with mock.patch("messenger.management.commands.seed_users.config", side_effect=fake_config):
        call_command("seed_users", stdout=output)
    return output.getvalue()


class SeedUsersTests(TestCase):
    def test_creates_the_two_users_named_in_the_env(self):
        run_seed(ENV)
        User = get_user_model()
        self.assertEqual(
            sorted(User.objects.values_list("username", flat=True)), ["diretor", "marcio"]
        )
        self.assertEqual(Profile.objects.count(), 2)

    def test_sets_the_passwords_from_the_env(self):
        run_seed(ENV)
        diretor = get_user_model().objects.get(username="diretor")
        self.assertTrue(diretor.check_password("senha-do-diretor-123"))

    def test_is_idempotent(self):
        run_seed(ENV)
        run_seed(ENV)
        self.assertEqual(get_user_model().objects.count(), 2)
        self.assertEqual(Profile.objects.count(), 2)

    def test_keeps_an_existing_password(self):
        run_seed(ENV)
        changed = {**ENV, "SEED_PASS_A": "outra-senha-qualquer"}
        output = run_seed(changed)
        diretor = get_user_model().objects.get(username="diretor")
        self.assertTrue(diretor.check_password("senha-do-diretor-123"))
        self.assertIn("senha mantida", output)

    def test_fails_when_a_variable_is_missing(self):
        incomplete = {key: value for key, value in ENV.items() if key != "SEED_PASS_B"}
        with self.assertRaisesMessage(CommandError, "SEED_PASS_B"):
            run_seed(incomplete)
        self.assertEqual(get_user_model().objects.count(), 0)

    def test_fails_when_both_usernames_are_equal(self):
        with self.assertRaisesMessage(CommandError, "precisam ser diferentes"):
            run_seed({**ENV, "SEED_USER_B": "diretor"})

    def test_warns_about_leftover_participants(self):
        make_participant("usuario1")
        output = run_seed(ENV)
        self.assertIn("Há 3 participantes", output)
