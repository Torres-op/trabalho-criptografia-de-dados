from datetime import datetime, timezone

from django.test import TestCase
from django.urls import reverse

from messenger.jwk import canonical_public_jwk
from messenger.models import Message

from .factories import JWK_A, make_blob, make_pair, make_superuser


class ProfileAdminTests(TestCase):
    def setUp(self):
        self.diretor, self.marcio = make_pair()
        profile = self.diretor.profile
        profile.ecdh_public_key = canonical_public_jwk(JWK_A)
        profile.key_registered_at = datetime(2026, 9, 1, 12, tzinfo=timezone.utc)
        profile.save()
        self.client.force_login(make_superuser())

    def test_superuser_sees_the_registered_keys(self):
        response = self.client.get(reverse("admin:messenger_profile_changelist"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "diretor")
        self.assertContains(response, "marcio")
        self.assertContains(response, "Chave registrada")

    def test_public_key_is_read_only(self):
        url = reverse("admin:messenger_profile_change", args=[self.diretor.profile.pk])
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, JWK_A["x"])
        self.assertNotContains(response, 'name="ecdh_public_key"')
        self.assertNotContains(response, 'name="user"')

    def test_reset_action_releases_a_new_registration(self):
        self.diretor.profile.fingerprint_verified = True
        self.diretor.profile.save()

        response = self.client.post(
            reverse("admin:messenger_profile_changelist"),
            {"action": "reset_public_key", "_selected_action": [self.diretor.profile.pk]},
            follow=True,
        )

        self.assertContains(response, "1 chave(s) apagada(s)")
        self.diretor.profile.refresh_from_db()
        self.assertEqual(self.diretor.profile.ecdh_public_key, "")
        self.assertIsNone(self.diretor.profile.key_registered_at)
        self.assertFalse(self.diretor.profile.fingerprint_verified)


class MessageAdminTests(TestCase):
    def setUp(self):
        self.diretor, self.marcio = make_pair()
        self.message = Message.objects.create(
            sender=self.diretor,
            recipient=self.marcio,
            blob=make_blob(),
            created_at=datetime(2026, 9, 1, 12, tzinfo=timezone.utc),
            direction=Message.Direction.SENT,
        )
        self.client.force_login(make_superuser())

    def test_lists_metadata_without_content(self):
        response = self.client.get(reverse("admin:messenger_message_changelist"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, f"{len(self.message.blob)} B")
        self.assertContains(response, "Enviada")

    def test_messages_cannot_be_added(self):
        response = self.client.get(reverse("admin:messenger_message_add"))
        self.assertEqual(response.status_code, 403)

    def test_messages_cannot_be_edited(self):
        url = reverse("admin:messenger_message_change", args=[self.message.pk])
        response = self.client.post(url, {"direction": Message.Direction.RECEIVED})
        self.assertEqual(response.status_code, 403)


class AdminAccessTests(TestCase):
    def test_admin_carries_the_app_name(self):
        self.client.force_login(make_superuser())
        response = self.client.get(reverse("admin:index"))
        self.assertContains(response, "Administração do Treehash")

    def test_participant_cannot_open_the_admin(self):
        diretor, _ = make_pair()
        self.client.force_login(diretor)
        response = self.client.get(reverse("admin:messenger_profile_changelist"))
        self.assertEqual(response.status_code, 302)
