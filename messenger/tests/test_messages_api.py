import hashlib
import json
from datetime import datetime, timezone

from django.test import Client, TestCase
from django.urls import reverse

from messenger.api import PAGE_SIZE
from messenger.models import Message

from .factories import CREATED_AT_MS, encode_blob, make_blob, make_pair, make_superuser

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


class ListMessagesTests(TestCase):
    def setUp(self):
        self.diretor, self.marcio = make_pair()
        self.client.force_login(self.diretor)

    def create_message(self, sender, recipient, direction, sender_id=0):
        return Message.objects.create(
            sender=sender,
            recipient=recipient,
            blob=make_blob(sender_id=sender_id),
            created_at=datetime(2026, 9, 17, 12, tzinfo=timezone.utc),
            direction=direction,
        )

    def test_lists_only_the_copy_the_logged_user_saved(self):
        mine = self.create_message(self.diretor, self.marcio, Message.Direction.SENT)
        self.create_message(self.diretor, self.marcio, Message.Direction.RECEIVED)

        body = self.client.get(MESSAGES_URL).json()

        self.assertEqual(body["count"], 1)
        self.assertEqual(body["results"][0]["id"], mine.pk)
        self.assertEqual(body["results"][0]["direction"], "sent")

    def test_each_participant_sees_their_own_copy(self):
        self.create_message(self.diretor, self.marcio, Message.Direction.SENT)
        theirs = self.create_message(self.diretor, self.marcio, Message.Direction.RECEIVED)

        self.client.force_login(self.marcio)
        body = self.client.get(MESSAGES_URL).json()

        self.assertEqual([item["id"] for item in body["results"]], [theirs.pk])

    def test_answers_with_metadata_and_never_with_the_blob(self):
        message = self.create_message(self.diretor, self.marcio, Message.Direction.SENT)
        response = self.client.get(MESSAGES_URL)
        item = response.json()["results"][0]

        self.assertEqual(
            sorted(item),
            ["createdAt", "direction", "id", "receivedAt", "recipient", "sender", "size"],
        )
        self.assertEqual(item["sender"], "diretor")
        self.assertEqual(item["recipient"], "marcio")
        self.assertEqual(item["size"], len(bytes(message.blob)))
        self.assertNotIn(encode_blob(bytes(message.blob)), response.content.decode())

    def test_newest_first(self):
        older = self.create_message(self.diretor, self.marcio, Message.Direction.SENT)
        newer = self.create_message(self.diretor, self.marcio, Message.Direction.SENT)
        for message, day in ((older, 1), (newer, 2)):
            Message.objects.filter(pk=message.pk).update(
                received_at=datetime(2026, 9, day, 12, tzinfo=timezone.utc)
            )

        body = self.client.get(MESSAGES_URL).json()

        self.assertEqual([item["id"] for item in body["results"]], [newer.pk, older.pk])

    def test_paginates(self):
        for _ in range(PAGE_SIZE + 5):
            self.create_message(self.diretor, self.marcio, Message.Direction.SENT)

        first = self.client.get(MESSAGES_URL).json()
        second = self.client.get(MESSAGES_URL, {"page": 2}).json()

        self.assertEqual(first["count"], PAGE_SIZE + 5)
        self.assertEqual(first["numPages"], 2)
        self.assertEqual(len(first["results"]), PAGE_SIZE)
        self.assertEqual(second["page"], 2)
        self.assertEqual(len(second["results"]), 5)

    def test_requires_login(self):
        response = Client().get(MESSAGES_URL)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "unauthenticated")

    def test_refuses_who_is_not_a_participant(self):
        self.client.force_login(make_superuser())
        response = self.client.get(MESSAGES_URL)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "not_participant")

    def test_refuses_other_methods(self):
        self.assertEqual(self.client.delete(MESSAGES_URL).status_code, 405)


class DeduplicationTests(TestCase):
    def setUp(self):
        self.diretor, self.marcio = make_pair()
        self.client.force_login(self.diretor)
        self.blob = make_blob(sender_id=0)
        self.digest = hashlib.sha256(self.blob).hexdigest()

    def save(self, direction=Message.Direction.SENT):
        return self.client.post(
            MESSAGES_URL,
            json.dumps({"blob": encode_blob(self.blob), "direction": direction}),
            content_type="application/json",
        )

    def head(self, digest, client=None):
        return (client or self.client).head(f"{MESSAGES_URL}?hash={digest}")

    def test_stores_the_hash_of_the_blob(self):
        self.save()
        self.assertEqual(Message.objects.get().blob_sha256, self.digest)

    def test_saving_the_same_file_twice_keeps_one_row(self):
        first = self.save()
        second = self.save()

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["id"], first.json()["id"])
        self.assertEqual(Message.objects.count(), 1)

    def test_says_whether_the_message_is_already_saved(self):
        self.assertEqual(self.head(self.digest).status_code, 404)
        self.save()
        self.assertEqual(self.head(self.digest).status_code, 200)

    def test_does_not_answer_for_the_copy_of_the_other_user(self):
        self.save()
        self.client.force_login(self.marcio)

        self.assertEqual(self.head(self.digest).status_code, 404)

    def test_both_users_keep_their_own_copy_of_the_same_file(self):
        self.save()
        self.client.force_login(self.marcio)
        response = self.save(direction=Message.Direction.RECEIVED)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Message.objects.count(), 2)

    def test_rejects_a_hash_that_is_not_a_hash(self):
        self.assertEqual(self.head("nao-e-um-hash").status_code, 400)
        self.assertEqual(self.client.head(MESSAGES_URL).status_code, 400)

    def test_requires_login(self):
        self.assertEqual(self.head(self.digest, client=Client()).status_code, 401)
