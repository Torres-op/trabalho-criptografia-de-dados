from datetime import datetime, timezone

from django.test import SimpleTestCase

from messenger.message_format import MAGIC, MAX_SIZE, MIN_SIZE, InvalidMessage, parse_header

from .factories import CREATED_AT_MS, make_blob


class ParseHeaderTests(SimpleTestCase):
    def test_uses_the_magic_fixed_by_d5(self):
        self.assertEqual(MAGIC, b"TRHS")

    def test_reads_every_field(self):
        header = parse_header(make_blob(sender_id=1, compressed=True))
        self.assertEqual(header.version, 1)
        self.assertTrue(header.compressed)
        self.assertEqual(header.sender_id, 1)

    def test_reads_created_at_with_millisecond_precision(self):
        header = parse_header(make_blob(created_at_ms=CREATED_AT_MS))
        expected = datetime.fromtimestamp(CREATED_AT_MS // 1000, tz=timezone.utc).replace(
            microsecond=(CREATED_AT_MS % 1000) * 1000
        )
        self.assertEqual(header.created_at, expected)

    def test_reads_the_uncompressed_flag(self):
        self.assertFalse(parse_header(make_blob(compressed=False)).compressed)

    def test_accepts_the_smallest_valid_file(self):
        self.assertEqual(len(make_blob(body_size=0)), MIN_SIZE)
        parse_header(make_blob(body_size=0))


class RejectionTests(SimpleTestCase):
    def mutated(self, position, value):
        blob = bytearray(make_blob())
        blob[position] = value
        return bytes(blob)

    def test_rejects_non_bytes(self):
        with self.assertRaisesMessage(InvalidMessage, "arquivo binário"):
            parse_header("TRHS")

    def test_rejects_files_smaller_than_header_plus_tag(self):
        with self.assertRaisesMessage(InvalidMessage, "tamanho mínimo"):
            parse_header(make_blob(body_size=0)[:-1])

    def test_rejects_files_above_the_limit(self):
        with self.assertRaisesMessage(InvalidMessage, "grande demais"):
            parse_header(make_blob(body_size=MAX_SIZE))

    def test_rejects_a_wrong_magic(self):
        with self.assertRaisesMessage(InvalidMessage, "não é uma mensagem"):
            parse_header(self.mutated(0, 0))

    def test_rejects_an_unknown_version(self):
        with self.assertRaisesMessage(InvalidMessage, "Versão"):
            parse_header(self.mutated(4, 9))

    def test_rejects_reserved_bits(self):
        with self.assertRaisesMessage(InvalidMessage, "bits reservados"):
            parse_header(self.mutated(5, 0x80))

    def test_rejects_an_invalid_sender_id(self):
        with self.assertRaisesMessage(InvalidMessage, "sender_id"):
            parse_header(self.mutated(6, 2))
