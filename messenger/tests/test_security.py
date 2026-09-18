import re

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import reverse

from core.middleware import ADMIN_POLICY, APP_POLICY

from .factories import PASSWORD, make_backup, make_pair

LOGIN_URL = reverse("messenger:login")


class ContentSecurityPolicyTests(TestCase):
    def test_app_pages_get_the_strict_policy(self):
        policy = self.client.get(LOGIN_URL).headers["Content-Security-Policy"]

        self.assertEqual(policy, APP_POLICY)
        self.assertNotIn("unsafe-inline", policy)

    def test_admin_keeps_room_for_its_own_inline_scripts(self):
        policy = self.client.get("/admin/login/").headers["Content-Security-Policy"]

        self.assertEqual(policy, ADMIN_POLICY)

    def test_no_page_carries_an_inline_script(self):
        diretor, _ = make_pair()
        make_backup(diretor)
        self.client.force_login(diretor)

        for name in ("compose", "translator", "history", "identity"):
            with self.subTest(page=name):
                body = self.client.get(reverse(f"messenger:{name}")).content.decode()
                for tag in re.findall(r"<script[^>]*>", body):
                    self.assertTrue(
                        'src="' in tag or 'type="application/json"' in tag,
                        f"script inline em {name}: {tag}",
                    )


@override_settings(LOGIN_MAX_ATTEMPTS=3, LOGIN_ATTEMPT_WINDOW=900)
class LoginThrottleTests(TestCase):
    def setUp(self):
        cache.clear()
        make_pair()

    def attempt(self, password="senha-errada", address="203.0.113.7"):
        return self.client.post(
            LOGIN_URL,
            {"username": "diretor", "password": password},
            REMOTE_ADDR=address,
        )

    def test_blocks_after_the_configured_attempts(self):
        for _ in range(3):
            self.assertEqual(self.attempt().status_code, 200)

        blocked = self.attempt()

        self.assertEqual(blocked.status_code, 429)
        self.assertContains(blocked, "Muitas tentativas", status_code=429)

    def test_a_correct_login_clears_the_counter(self):
        self.attempt()
        self.attempt()

        self.assertEqual(self.attempt(password=PASSWORD).status_code, 302)
        self.assertEqual(self.attempt().status_code, 200)

    def test_counts_each_address_on_its_own(self):
        for _ in range(3):
            self.attempt(address="203.0.113.7")

        self.assertEqual(self.attempt(address="198.51.100.2").status_code, 200)

    def test_never_blocks_the_form_itself(self):
        for _ in range(4):
            self.attempt()

        self.assertEqual(self.client.get(LOGIN_URL).status_code, 200)
