import json

from django.test import SimpleTestCase

from messenger.jwk import InvalidPublicKey, canonical_public_jwk, load_public_jwk

from .factories import JWK_A


class CanonicalPublicJwkTests(SimpleTestCase):
    def test_keeps_only_the_four_public_members_in_lexicographic_order(self):
        canonical = canonical_public_jwk({**JWK_A, "ext": True, "key_ops": []})
        self.assertEqual(
            canonical,
            json.dumps(
                {"crv": "P-256", "kty": "EC", "x": JWK_A["x"], "y": JWK_A["y"]},
                separators=(",", ":"),
            ),
        )

    def test_is_independent_of_input_member_order(self):
        reordered = {"y": JWK_A["y"], "x": JWK_A["x"], "kty": "EC", "crv": "P-256"}
        self.assertEqual(canonical_public_jwk(reordered), canonical_public_jwk(JWK_A))

    def test_has_no_whitespace(self):
        self.assertNotIn(" ", canonical_public_jwk(JWK_A))

    def test_round_trips_through_load(self):
        loaded = load_public_jwk(canonical_public_jwk(JWK_A))
        self.assertEqual(loaded, {key: JWK_A[key] for key in ("crv", "kty", "x", "y")})


class RejectionTests(SimpleTestCase):
    def assert_rejected(self, value, fragment):
        with self.assertRaisesMessage(InvalidPublicKey, fragment):
            canonical_public_jwk(value)

    def test_rejects_non_objects(self):
        for value in (None, "jwk", 42, [JWK_A]):
            with self.subTest(value=value):
                self.assert_rejected(value, "objeto JWK")

    def test_rejects_a_private_key(self):
        self.assert_rejected({**JWK_A, "d": "segredo"}, "chave privada")

    def test_rejects_other_key_types(self):
        self.assert_rejected({**JWK_A, "kty": "RSA"}, "Tipo de chave")

    def test_rejects_other_curves(self):
        self.assert_rejected({**JWK_A, "crv": "P-384"}, "Curva")

    def test_rejects_missing_coordinates(self):
        for member in ("x", "y"):
            incomplete = {key: value for key, value in JWK_A.items() if key != member}
            with self.subTest(member=member):
                self.assert_rejected(incomplete, f"coordenada {member}")

    def test_rejects_standard_base64_characters(self):
        self.assert_rejected({**JWK_A, "x": JWK_A["x"][:-1] + "+"}, "base64url")

    def test_rejects_padding(self):
        self.assert_rejected({**JWK_A, "x": JWK_A["x"] + "="}, "base64url")

    def test_rejects_coordinates_of_the_wrong_length(self):
        self.assert_rejected({**JWK_A, "x": "AAAA"}, "32 bytes")

    def test_rejects_impossible_base64_lengths(self):
        self.assert_rejected({**JWK_A, "x": "A"}, "coordenada x")
