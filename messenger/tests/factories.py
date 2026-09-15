import base64
import struct

from django.contrib.auth import get_user_model

from messenger.message_format import FLAG_COMPRESSED, IV_SIZE, MAGIC, TAG_SIZE, VERSION
from messenger.models import Profile

PASSWORD = "senha-de-teste-123"
CREATED_AT_MS = 1_788_940_294_016

JWK_A = {
    "kty": "EC",
    "crv": "P-256",
    "x": "f83OJ3D2xF1Bg8vub9tD2VqV6uNRnCVvzOgOb5m7Vfs",
    "y": "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0",
}

JWK_B = {
    "kty": "EC",
    "crv": "P-256",
    "x": "MKBCTNIcKUSDii11ySs3526iDZ8AiTo7Tu6KPAqv7D4",
    "y": "4Etl6SRW2YiLUrN5vfvVHuhp7x8PxltmWWlbbM4IFyM",
}


def make_participant(username):
    user = get_user_model().objects.create_user(username=username, password=PASSWORD)
    Profile.objects.create(user=user)
    return user


def make_pair(first="diretor", second="marcio"):
    return make_participant(first), make_participant(second)


def make_superuser(username="admin"):
    return get_user_model().objects.create_superuser(
        username=username, password=PASSWORD, email=f"{username}@example.com"
    )


def make_blob(sender_id=0, created_at_ms=CREATED_AT_MS, compressed=True, body_size=24):
    flags = FLAG_COMPRESSED if compressed else 0
    header = (
        MAGIC
        + bytes([VERSION, flags, sender_id])
        + struct.pack(">Q", created_at_ms)
        + bytes(IV_SIZE)
    )
    return header + bytes([0xAB]) * (body_size + TAG_SIZE)


def encode_blob(blob):
    return base64.b64encode(blob).decode("ascii")
