import json

from django.test import Client, TestCase
from django.urls import reverse

from messenger.jwk import canonical_public_jwk

from .factories import JWK_A, JWK_B, make_pair, make_superuser

PUBLISH_URL = reverse("messenger:api-publish-public-key")


def key_url(username):
    return reverse("messenger:api-public-key", args=[username])


class PublishPublicKeyTests(TestCase):
    def setUp(self):
        self.diretor, self.marcio = make_pair()
        self.client.force_login(self.diretor)

    def publish(self, jwk, client=None):
        return (client or self.client).post(
            PUBLISH_URL, json.dumps({"jwk": jwk}), content_type="application/json"
        )

    def test_registers_the_first_key(self):
        response = self.publish(JWK_A)
        self.assertEqual(response.status_code, 201)

        profile = self.diretor.profile
        profile.refresh_from_db()
        self.assertEqual(profile.ecdh_public_key, canonical_public_jwk(JWK_A))
        self.assertIsNotNone(profile.key_registered_at)
        self.assertFalse(profile.fingerprint_verified)

    def test_answers_with_the_stored_key(self):
        body = self.publish(JWK_A).json()
        self.assertEqual(body["username"], "diretor")
        self.assertEqual(body["jwk"]["x"], JWK_A["x"])
        self.assertIsNotNone(body["registeredAt"])

    def test_repeating_the_same_key_is_idempotent(self):
        self.publish(JWK_A)
        response = self.publish({**JWK_A, "ext": True, "key_ops": []})
        self.assertEqual(response.status_code, 200)

    def test_a_different_key_is_a_conflict(self):
        self.publish(JWK_A)
        response = self.publish(JWK_B)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "key_conflict")
        self.diretor.profile.refresh_from_db()
        self.assertEqual(self.diretor.profile.ecdh_public_key, canonical_public_jwk(JWK_A))

    def test_rejects_invalid_json(self):
        response = self.client.post(PUBLISH_URL, "{nao-e-json", content_type="application/json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "invalid_json")

    def test_rejects_an_invalid_key(self):
        response = self.publish({**JWK_A, "crv": "P-384"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "invalid_jwk")

    def test_rejects_a_private_key(self):
        response = self.publish({**JWK_A, "d": "segredo"})
        self.assertEqual(response.status_code, 400)
        self.diretor.profile.refresh_from_db()
        self.assertEqual(self.diretor.profile.ecdh_public_key, "")

    def test_rejects_other_methods(self):
        self.assertEqual(self.client.get(PUBLISH_URL).status_code, 405)

    def test_requires_login(self):
        response = self.publish(JWK_A, client=Client())
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "unauthenticated")

    def test_rejects_users_outside_the_conversation(self):
        admin_client = Client()
        admin_client.force_login(make_superuser())
        response = self.publish(JWK_A, client=admin_client)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "not_participant")


class CsrfTests(TestCase):
    def setUp(self):
        self.diretor, _ = make_pair()
        self.client = Client(enforce_csrf_checks=True)
        self.client.force_login(self.diretor)

    def test_rejects_a_post_without_the_token(self):
        response = self.client.post(
            PUBLISH_URL, json.dumps({"jwk": JWK_A}), content_type="application/json"
        )
        self.assertEqual(response.status_code, 403)

    def test_accepts_the_token_delivered_in_the_page(self):
        page = self.client.get(reverse("messenger:compose"))
        token = page.context["session"]["csrfToken"]
        response = self.client.post(
            PUBLISH_URL,
            json.dumps({"jwk": JWK_A}),
            content_type="application/json",
            headers={"X-CSRFToken": token},
        )
        self.assertEqual(response.status_code, 201)


class FetchPublicKeyTests(TestCase):
    def setUp(self):
        self.diretor, self.marcio = make_pair()
        self.client.force_login(self.diretor)

    def register(self, user, jwk):
        user.profile.ecdh_public_key = canonical_public_jwk(jwk)
        user.profile.save()

    def test_peer_without_a_key_is_reported_as_not_published(self):
        response = self.client.get(key_url("marcio"))
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "key_not_published")

    def test_returns_the_peer_key_once_published(self):
        self.register(self.marcio, JWK_B)
        response = self.client.get(key_url("marcio"))
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["username"], "marcio")
        self.assertEqual(body["jwk"], {key: JWK_B[key] for key in ("crv", "kty", "x", "y")})

    def test_returns_the_own_key(self):
        self.register(self.diretor, JWK_A)
        self.assertEqual(self.client.get(key_url("diretor")).status_code, 200)

    def test_unknown_user_is_not_found(self):
        response = self.client.get(key_url("ninguem"))
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "user_not_found")

    def test_does_not_reveal_users_outside_the_conversation(self):
        make_superuser("admin")
        response = self.client.get(key_url("admin"))
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "user_not_found")

    def test_requires_login(self):
        self.assertEqual(Client().get(key_url("marcio")).status_code, 401)

    def test_rejects_other_methods(self):
        self.assertEqual(self.client.post(key_url("marcio")).status_code, 405)
