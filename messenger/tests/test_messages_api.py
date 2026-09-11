import json
from datetime import datetime, timezone

from django.test import Client, TestCase
from django.urls import reverse

from messenger.models import Message

from .factories import CREATED_AT_MS, encode_blob, make_blob, make_pair

MESSAGES_URL = reverse("messenger:api-messages")


class SaveMessageTests(TestCase):
    def setUp(self):
        self.diretor, self.marcio = make_pair()
        self.client.force_login(self.diretor)

    def save(self, payload, client=None):
        return (client or self.client).post(
            MESSAGES_URL, json.dumps(payload), content_type="application/json"
        )

    def test_saves_a_sent_message_from_the_logged_user(self):
        blob = make_blob(sender_id=0)
        response = self.save({"blob": encode_blob(blob), "direction": "sent"})

        self.assertEqual(response.status_code, 201)
        message = Message.objects.get()
        self.assertEqual(message.sender, self.diretor)
        self.assertEqual(message.recipient, self.marcio)
        self.assertEqual(message.direction, Message.Direction.SENT)
        self.assertEqual(bytes(message.blob), blob)

    def test_saves_a_received_message_from_the_peer(self):
        response = self.save({"blob": encode_blob(make_blob(sender_id=1)), "direction": "received"})

        self.assertEqual(response.status_code, 201)
        message = Message.objects.get()
        self.assertEqual(message.sender, self.marcio)
        self.assertEqual(message.recipient, self.diretor)

    def test_takes_created_at_from_the_header(self):
        self.save({"blob": encode_blob(make_blob(sender_id=0)), "direction": "sent"})
        expected = datetime.fromtimestamp(CREATED_AT_MS // 1000, tz=timezone.utc).replace(
            microsecond=(CREATED_AT_MS % 1000) * 1000
        )
        self.assertEqual(Message.objects.get().created_at, expected)

    def test_answers_with_the_saved_metadata(self):
        blob = make_blob(sender_id=0)
        body = self.save({"blob": encode_blob(blob), "direction": "sent"}).json()
        self.assertEqual(body["direction"], "sent")
        self.assertEqual(body["size"], len(blob))
        self.assertIn("receivedAt", body)

    def test_rejects_a_header_that_names_the_other_sender(self):
        response = self.save({"blob": encode_blob(make_blob(sender_id=1)), "direction": "sent"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "sender_mismatch")
        self.assertFalse(Message.objects.exists())

    def test_rejects_an_unknown_direction(self):
        response = self.save({"blob": encode_blob(make_blob()), "direction": "enviada"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "invalid_direction")

    def test_rejects_invalid_base64(self):
        response = self.save({"blob": "***", "direction": "sent"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "invalid_message")

    def test_rejects_a_file_that_is_not_a_message(self):
        response = self.save({"blob": encode_blob(bytes(64)), "direction": "sent"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("não é uma mensagem", response.json()["error"])

    def test_rejects_invalid_json(self):
        response = self.client.post(MESSAGES_URL, "[]", content_type="application/json")
        self.assertEqual(response.status_code, 400)

    def test_requires_login(self):
        response = self.save({"blob": encode_blob(make_blob()), "direction": "sent"}, Client())
        self.assertEqual(response.status_code, 401)

    def test_the_other_user_saves_with_the_opposite_sender_id(self):
        other = Client()
        other.force_login(self.marcio)
        response = self.save({"blob": encode_blob(make_blob(sender_id=1)), "direction": "sent"}, other)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Message.objects.get().sender, self.marcio)
