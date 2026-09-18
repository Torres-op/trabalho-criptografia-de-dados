from django.contrib.auth.models import AnonymousUser
from django.core.exceptions import PermissionDenied
from django.test import TestCase

from messenger.participants import (
    NotAParticipant,
    ParticipantsNotConfigured,
    get_other_user,
    ordered_usernames,
    participants,
    sender_id_for,
)

from .factories import make_pair, make_participant, make_superuser


class GetOtherUserTests(TestCase):
    def test_returns_the_other_participant_for_each_side(self):
        diretor, marcio = make_pair()
        self.assertEqual(get_other_user(diretor), marcio)
        self.assertEqual(get_other_user(marcio), diretor)

    def test_fails_with_a_single_participant(self):
        only = make_participant("diretor")
        with self.assertRaisesMessage(ParticipantsNotConfigured, "encontrou 1 (diretor)"):
            get_other_user(only)

    def test_fails_with_three_participants(self):
        diretor, _ = make_pair()
        make_participant("terceiro")
        with self.assertRaisesMessage(ParticipantsNotConfigured, "encontrou 3"):
            get_other_user(diretor)

    def test_superuser_without_profile_does_not_count(self):
        diretor, marcio = make_pair()
        make_superuser()
        self.assertEqual(participants().count(), 2)
        self.assertEqual(get_other_user(diretor), marcio)

    def test_superuser_is_not_a_participant(self):
        make_pair()
        admin = make_superuser()
        with self.assertRaises(NotAParticipant):
            get_other_user(admin)

    def test_not_a_participant_becomes_http_403(self):
        self.assertTrue(issubclass(NotAParticipant, PermissionDenied))

    def test_anonymous_user_is_not_a_participant(self):
        make_pair()
        with self.assertRaises(NotAParticipant):
            get_other_user(AnonymousUser())


class OrderingTests(TestCase):
    def test_order_does_not_depend_on_argument_order(self):
        self.assertEqual(ordered_usernames("marcio", "diretor"), ["diretor", "marcio"])
        self.assertEqual(ordered_usernames("diretor", "marcio"), ["diretor", "marcio"])

    def test_uppercase_sorts_before_lowercase_like_javascript(self):
        self.assertEqual(ordered_usernames("ana", "Zoe"), ["Zoe", "ana"])

    def test_uses_utf16_code_units_to_match_the_browser(self):
        fullwidth_a = chr(0xFF21)
        double_struck_x = chr(0x1D54F)
        self.assertEqual(
            ordered_usernames(fullwidth_a, double_struck_x),
            [double_struck_x, fullwidth_a],
        )

    def test_sender_id_matches_position_in_the_ordered_pair(self):
        diretor, marcio = make_pair()
        self.assertEqual(sender_id_for(diretor, marcio), 0)
        self.assertEqual(sender_id_for(marcio, diretor), 1)
