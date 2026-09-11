from datetime import datetime, timezone

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

BEFORE = [("messenger", "0002_mensagem")]
AFTER = [("messenger", "0003_english_identifiers")]
MOMENT = datetime(2026, 9, 1, 12, tzinfo=timezone.utc)


def migrate_to(targets):
    executor = MigrationExecutor(connection)
    executor.loader.build_graph()
    executor.migrate(targets)
    return executor.loader.project_state(targets).apps


class EnglishIdentifiersMigrationTests(TransactionTestCase):
    def setUp(self):
        old = migrate_to(BEFORE)
        User = old.get_model("auth", "User")
        Profile = old.get_model("messenger", "Profile")
        Mensagem = old.get_model("messenger", "Mensagem")

        ana = User.objects.create(username="ana")
        bia = User.objects.create(username="bia")
        Profile.objects.create(
            user=ana, chave_publica_ecdh='{"crv":"P-256"}', fingerprint_verificado=True
        )
        Profile.objects.create(user=bia)
        Mensagem.objects.create(
            remetente=ana, destinatario=bia, blob=b"abc", criado_em=MOMENT, origem="enviada"
        )
        Mensagem.objects.create(
            remetente=bia, destinatario=ana, blob=b"xyz", criado_em=MOMENT, origem="recebida"
        )
        self.ids = {"ana": ana.pk, "bia": bia.pk}
        self.apps = migrate_to(AFTER)

    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(executor.loader.graph.leaf_nodes())

    def test_preserves_profile_data_under_the_new_names(self):
        Profile = self.apps.get_model("messenger", "Profile")
        profile = Profile.objects.get(user_id=self.ids["ana"])
        self.assertEqual(profile.ecdh_public_key, '{"crv":"P-256"}')
        self.assertTrue(profile.fingerprint_verified)

    def test_preserves_messages_under_the_new_model(self):
        Message = self.apps.get_model("messenger", "Message")
        self.assertEqual(Message.objects.count(), 2)
        sent = Message.objects.get(sender_id=self.ids["ana"])
        self.assertEqual(sent.recipient_id, self.ids["bia"])
        self.assertEqual(bytes(sent.blob), b"abc")
        self.assertEqual(sent.created_at, MOMENT)

    def test_translates_direction_values_to_english(self):
        Message = self.apps.get_model("messenger", "Message")
        self.assertEqual(
            dict(Message.objects.values_list("sender_id", "direction")),
            {self.ids["ana"]: "sent", self.ids["bia"]: "received"},
        )

    def test_replaces_the_index(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT indexname FROM pg_indexes WHERE tablename = %s", ["messenger_message"]
            )
            names = {row[0] for row in cursor.fetchall()}
        self.assertIn("message_recipient_idx", names)
        self.assertNotIn("messenger_m_destina_55da45_idx", names)

    def test_is_reversible(self):
        old = migrate_to(BEFORE)
        Mensagem = old.get_model("messenger", "Mensagem")
        self.assertEqual(
            set(Mensagem.objects.values_list("origem", flat=True)), {"enviada", "recebida"}
        )
