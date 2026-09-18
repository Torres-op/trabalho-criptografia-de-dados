import base64
import json

from django.test import Client, SimpleTestCase, TestCase
from django.urls import reverse

from messenger.jwk import canonical_public_jwk, fingerprint
from messenger.key_backup_format import MAGIC as BACKUP_MAGIC
from messenger.key_backup_format import VERSION as BACKUP_VERSION
from messenger.key_backup_format import InvalidBackup, validate_backup
from messenger.models import KeyBackup

from .factories import JWK_B, make_backup, make_backup_blob, make_pair, make_superuser

BACKUP_URL = reverse("messenger:api-key-backup")
FINGERPRINT_URL = reverse("messenger:api-fingerprint")


class SaveBackupTests(TestCase):
    def setUp(self):
        self.diretor, self.marcio = make_pair()
        self.client.force_login(self.diretor)

    def save(self, blob=None, client=None):
        blob = make_backup_blob() if blob is None else blob
        return (client or self.client).post(
            BACKUP_URL,
            json.dumps({"blob": base64.b64encode(blob).decode()}),
            content_type="application/json",
        )

    def test_stores_the_encrypted_blob(self):
        blob = make_backup_blob()
        response = self.save(blob)
        backup = KeyBackup.objects.get()

        self.assertEqual(response.status_code, 201)
        self.assertEqual(backup.user, self.diretor)
        self.assertEqual(bytes(backup.blob), blob)
        self.assertEqual(response.json()["size"], len(blob))

    def test_keeps_every_version(self):
        self.save(make_backup_blob(filler=b"a"))
        self.save(make_backup_blob(filler=b"b"))

        self.assertEqual(KeyBackup.objects.count(), 2)

    def test_rejects_invalid_base64(self):
        response = self.client.post(
            BACKUP_URL, json.dumps({"blob": "isto não é base64"}), content_type="application/json"
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "invalid_backup")

    def test_rejects_a_backup_that_is_too_big(self):
        response = self.save(make_backup_blob(extra=9000))

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "invalid_backup")

    def test_rejects_bytes_that_are_not_a_backup(self):
        response = self.save(b"isto nao e um backup, so bytes soltos aqui dentro" * 3)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "invalid_backup")
        self.assertFalse(KeyBackup.objects.exists())

    def test_rejects_a_backup_from_another_version(self):
        response = self.save(make_backup_blob(version=9))

        self.assertEqual(response.status_code, 400)
        self.assertIn("versão 9", response.json()["error"])

    def test_rejects_a_backup_that_is_too_short(self):
        response = self.save(make_backup_blob()[:40])

        self.assertEqual(response.status_code, 400)
        self.assertIn("incompleto", response.json()["error"])

    def test_requires_login(self):
        self.assertEqual(self.save(client=Client()).status_code, 401)

    def test_refuses_who_is_not_a_participant(self):
        self.client.force_login(make_superuser())

        self.assertEqual(self.save().status_code, 403)


class FetchBackupTests(TestCase):
    def setUp(self):
        self.diretor, self.marcio = make_pair()
        self.client.force_login(self.diretor)

    def test_returns_the_newest_backup(self):
        make_backup(self.diretor, b"antigo")
        make_backup(self.diretor, b"novo")

        body = self.client.get(BACKUP_URL).json()

        self.assertEqual(base64.b64decode(body["blob"]), b"novo")

    def test_answers_404_when_there_is_no_backup(self):
        response = self.client.get(BACKUP_URL)

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "backup_not_found")

    def test_never_returns_the_backup_of_the_other_user(self):
        make_backup(self.marcio, b"chave do marcio")

        self.assertEqual(self.client.get(BACKUP_URL).status_code, 404)

    def test_requires_login(self):
        make_backup(self.diretor)

        self.assertEqual(Client().get(BACKUP_URL).status_code, 401)


class VerifyFingerprintTests(TestCase):
    def setUp(self):
        self.diretor, self.marcio = make_pair()
        self.canonical = canonical_public_jwk(JWK_B)
        profile = self.marcio.profile
        profile.ecdh_public_key = self.canonical
        profile.save()
        self.client.force_login(self.diretor)

    def verify(self, value, client=None):
        return (client or self.client).post(
            FINGERPRINT_URL, json.dumps({"fingerprint": value}), content_type="application/json"
        )

    def test_marks_the_key_of_the_other_user_as_verified(self):
        response = self.verify(fingerprint(self.canonical))
        self.marcio.profile.refresh_from_db()

        self.assertEqual(response.status_code, 200)
        self.assertTrue(self.marcio.profile.fingerprint_verified)
        self.assertTrue(response.json()["fingerprintVerified"])

    def test_accepts_the_code_with_spaces_and_capitals(self):
        response = self.verify(f"  {fingerprint(self.canonical).upper()}  ")

        self.assertEqual(response.status_code, 200)

    def test_refuses_a_fingerprint_that_does_not_match(self):
        response = self.verify("0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000")
        self.marcio.profile.refresh_from_db()

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "fingerprint_mismatch")
        self.assertFalse(self.marcio.profile.fingerprint_verified)

    def test_answers_404_when_the_other_user_has_no_key(self):
        profile = self.marcio.profile
        profile.ecdh_public_key = ""
        profile.save()

        self.assertEqual(self.verify("qualquer").status_code, 404)

    def test_requires_login(self):
        self.assertEqual(self.verify("qualquer", client=Client()).status_code, 401)


class BackupFormatTests(SimpleTestCase):
    def test_uses_the_magic_fixed_for_the_browser(self):
        self.assertEqual(BACKUP_MAGIC, b"TKEY")
        self.assertEqual(BACKUP_VERSION, 1)

    def test_accepts_a_well_formed_envelope(self):
        self.assertEqual(validate_backup(make_backup_blob()), make_backup_blob())

    def test_refuses_anything_that_is_not_bytes(self):
        with self.assertRaises(InvalidBackup):
            validate_backup("uma string")
