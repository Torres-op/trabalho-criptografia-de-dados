import json

from django.test import TestCase
from django.urls import reverse

from messenger.participants import ParticipantsNotConfigured

from .factories import make_pair, make_participant, make_superuser


class PageAccessTests(TestCase):
    def test_pages_require_login(self):
        for name in ("compose", "translator"):
            with self.subTest(page=name):
                response = self.client.get(reverse(f"messenger:{name}"))
                self.assertEqual(response.status_code, 302)
                self.assertIn(reverse("messenger:login"), response["Location"])

    def test_participant_opens_both_pages(self):
        diretor, _ = make_pair()
        self.client.force_login(diretor)
        for name in ("compose", "translator"):
            with self.subTest(page=name):
                self.assertEqual(self.client.get(reverse(f"messenger:{name}")).status_code, 200)

    def test_superuser_is_forbidden_on_the_pages(self):
        make_pair()
        self.client.force_login(make_superuser())
        self.assertEqual(self.client.get(reverse("messenger:compose")).status_code, 403)

    def test_misconfigured_system_fails_loudly(self):
        only = make_participant("diretor")
        self.client.force_login(only)
        with self.assertRaises(ParticipantsNotConfigured):
            self.client.get(reverse("messenger:compose"))


class SessionDataTests(TestCase):
    def setUp(self):
        self.diretor, self.marcio = make_pair()
        self.client.force_login(self.diretor)

    def session_data(self, page="compose"):
        response = self.client.get(reverse(f"messenger:{page}"))
        self.assertContains(response, 'id="session-data"')
        return response.context["session"]

    def test_exposes_who_is_talking_to_whom(self):
        data = self.session_data()
        self.assertEqual(data["username"], "diretor")
        self.assertEqual(data["peerUsername"], "marcio")

    def test_exposes_the_api_endpoints(self):
        endpoints = self.session_data()["endpoints"]
        self.assertEqual(endpoints["publishPublicKey"], "/api/public-key/")
        self.assertEqual(endpoints["peerPublicKey"], "/api/public-key/marcio/")
        self.assertEqual(endpoints["messages"], "/api/messages/")

    def test_is_rendered_as_inert_json(self):
        response = self.client.get(reverse("messenger:translator"))
        self.assertContains(response, 'type="application/json"')
        body = response.content.decode()
        start = body.index('id="session-data" type="application/json">') + len(
            'id="session-data" type="application/json">'
        )
        end = body.index("</script>", start)
        self.assertEqual(json.loads(body[start:end])["peerUsername"], "marcio")


class LayoutTests(TestCase):
    def test_pages_carry_the_app_name(self):
        response = self.client.get(reverse("messenger:login"))
        self.assertContains(response, "<title>Entrar — Treehash</title>")
        self.assertContains(response, '<span class="brand">Treehash</span>')

    def test_login_page_hides_the_navigation(self):
        response = self.client.get(reverse("messenger:login"))
        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, "Sair")
        self.assertNotContains(response, 'id="session-data"')

    def test_authenticated_pages_show_the_user_and_logout(self):
        diretor, _ = make_pair()
        self.client.force_login(diretor)
        response = self.client.get(reverse("messenger:compose"))
        self.assertContains(response, "Sair")
        self.assertContains(response, 'class="account__name">diretor')
